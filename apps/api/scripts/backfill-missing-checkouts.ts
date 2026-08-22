/**
 * Fill checkOut on historical REGULAR attendance rows that have checkIn
 * but no checkOut. Uses each row's duty end (snapshot when present,
 * otherwise current employee duty). Overnight shifts get end on the next
 * calendar day via computeShiftEndDateTime.
 *
 * Also reverses missing-checkout discipline for that date (if any) and
 * recomputes PENDING payroll for the row's month. Does NOT issue new
 * letters. Skips 24-hour staff (checkout never required).
 *
 * Default scope: all open sessions with date < today (Pakistan). Today's
 * still-open sessions are left alone so live checkouts can still happen.
 *
 * Usage (from apps/api):
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-missing-checkouts.ts
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-missing-checkouts.ts --apply
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-missing-checkouts.ts --since 2026-08-01 --until 2026-08-20 --apply
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-missing-checkouts.ts --include-today --apply
 *
 * --until YYYY-MM-DD is exclusive (e.g. --until 2026-08-20 = through 19 Aug only).
 */
import {
  AttendanceLogType,
  AttendanceStatus,
  PrismaClient,
} from '@prisma/client';
import { resolveAttendanceDutyTimes } from '../src/common/duty.util';
import {
  is24HourShift,
  isOvernightShift,
} from '../src/modules/attendance/attendance-biometric.util';
import { toPakistanDateOnly } from '../src/modules/attendance/attendance-late.util';
import { reconcileAttendanceFinancialConsequences } from '../src/modules/attendance/discipline.helper';
import { computeShiftEndDateTime } from '../src/modules/attendance/shift-time.util';
import { PayrollService } from '../src/modules/payroll/payroll.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccessScopeService } from '../src/modules/permissions/access-scope.service';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const INCLUDE_TODAY = process.argv.includes('--include-today');

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

const SINCE = argValue('--since'); // YYYY-MM-DD optional lower bound (inclusive)
const UNTIL = argValue('--until'); // YYYY-MM-DD optional upper bound (exclusive)

const CLOSURE_NOTE = 'Auto-closed missing checkout at duty end';

function parseDay(label: string, flag: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    throw new Error(`Invalid ${flag} ${label}; expected YYYY-MM-DD`);
  }
  return new Date(`${label}T00:00:00.000Z`);
}

async function main() {
  const now = new Date();
  const pkToday = toPakistanDateOnly(now);

  // When --until is set, it is the exclusive end of the range and replaces
  // the default "before today" cap. --include-today only applies when
  // --until is omitted.
  const dateFilter: { lt?: Date; lte?: Date; gte?: Date } = {};

  if (UNTIL) {
    dateFilter.lt = parseDay(UNTIL, '--until');
  } else if (INCLUDE_TODAY) {
    dateFilter.lte = pkToday;
  } else {
    dateFilter.lt = pkToday;
  }

  if (SINCE) {
    dateFilter.gte = parseDay(SINCE, '--since');
  }

  if (
    dateFilter.gte &&
    dateFilter.lt &&
    dateFilter.gte.getTime() >= dateFilter.lt.getTime()
  ) {
    throw new Error('--since must be before --until');
  }
  if (
    dateFilter.gte &&
    dateFilter.lte &&
    dateFilter.gte.getTime() > dateFilter.lte.getTime()
  ) {
    throw new Error('--since must be on or before the inclusive end date');
  }

  const scopeEndLabel = UNTIL
    ? `< ${UNTIL}`
    : INCLUDE_TODAY
      ? `<= ${pkToday.toISOString().slice(0, 10)}`
      : `< ${pkToday.toISOString().slice(0, 10)}`;

  console.log(
    APPLY
      ? 'APPLY — writing checkOut at duty end for open sessions'
      : 'DRY-RUN — listing open sessions (pass --apply to write checkOut)',
  );
  console.log(
    `Scope: date ${scopeEndLabel}` +
      (SINCE ? ` and >= ${SINCE}` : '') +
      '\n',
  );

  const rows = await prisma.attendanceLog.findMany({
    where: {
      type: AttendanceLogType.REGULAR,
      date: dateFilter,
      checkIn: { not: null },
      checkOut: null,
      status: {
        notIn: [
          AttendanceStatus.ON_LEAVE,
          AttendanceStatus.SHORT_LEAVE,
          AttendanceStatus.ABSENT,
          AttendanceStatus.UNINFORMED_ABSENT,
          AttendanceStatus.UNMARKED,
        ],
      },
    },
    include: {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          fullName: true,
          dutyStartTime: true,
          dutyEndTime: true,
          dutyTotalHours: true,
          shift: { select: { name: true, startTime: true, endTime: true } },
        },
      },
    },
    orderBy: [{ date: 'asc' }, { employeeId: 'asc' }],
  });

  type Plan = {
    id: string;
    code: string;
    name: string;
    date: string;
    checkIn: Date;
    checkOut: Date;
    dutyEnd: string;
    status: AttendanceStatus;
    skipReason?: string;
  };

  const plans: Plan[] = [];
  let skipped24h = 0;
  let skippedNoDuty = 0;
  let skippedInvalid = 0;

  for (const row of rows) {
    const employee = row.employee;
    const code = employee?.employeeCode ?? row.employeeId;
    const name = employee?.fullName ?? '';
    const dateLabel = row.date.toISOString().slice(0, 10);

    if (!employee || !row.checkIn) {
      skippedInvalid++;
      continue;
    }

    if (is24HourShift(employee)) {
      skipped24h++;
      continue;
    }

    const duty = resolveAttendanceDutyTimes(row, employee);
    if (!duty.dutyStartTime || !duty.dutyEndTime) {
      skippedNoDuty++;
      console.log(
        `[skip no-duty] ${code} ${name} ${dateLabel} — no duty start/end`,
      );
      continue;
    }

    const crossesMidnight = isOvernightShift(
      duty.dutyStartTime,
      duty.dutyEndTime,
    );
    const checkOut = computeShiftEndDateTime(
      row.date,
      duty.dutyEndTime,
      crossesMidnight,
    );

    if (checkOut.getTime() <= row.checkIn.getTime()) {
      skippedInvalid++;
      console.log(
        `[skip invalid-end] ${code} ${name} ${dateLabel} — duty end ${checkOut.toISOString()} <= checkIn ${row.checkIn.toISOString()}`,
      );
      continue;
    }

    plans.push({
      id: row.id,
      code,
      name,
      date: dateLabel,
      checkIn: row.checkIn,
      checkOut,
      dutyEnd: duty.dutyEndTime,
      status: row.status,
    });
  }

  console.log(`Open rows matched filter: ${rows.length}`);
  console.log(`Will close at duty end: ${plans.length}`);
  console.log(`Skipped 24h staff: ${skipped24h}`);
  console.log(`Skipped no duty times: ${skippedNoDuty}`);
  console.log(`Skipped invalid/missing: ${skippedInvalid}`);
  console.log('\nSample (up to 20):');
  for (const p of plans.slice(0, 20)) {
    console.log(
      `  ${p.code} ${p.name} | ${p.date} | ${p.status} | in=${p.checkIn.toISOString()} → out=${p.checkOut.toISOString()} (dutyEnd ${p.dutyEnd})`,
    );
  }
  if (plans.length > 20) console.log(`  … +${plans.length - 20} more`);

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to write checkOut.');
    return;
  }

  if (plans.length === 0) {
    console.log('\nNothing to apply.');
    return;
  }

  const payrollService = new PayrollService(
    prisma as unknown as PrismaService,
    {} as unknown as AccessScopeService,
  );

  let updated = 0;
  let failed = 0;

  for (const plan of plans) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const before = await tx.attendanceLog.findUnique({
            where: { id: plan.id },
          });
          if (!before || before.checkOut != null || !before.checkIn) {
            return;
          }

          const noteParts = [before.note?.trim(), CLOSURE_NOTE].filter(Boolean);
          const after = await tx.attendanceLog.update({
            where: { id: plan.id },
            data: {
              checkOut: plan.checkOut,
              sessionClosedAt: before.sessionClosedAt ?? now,
              note: noteParts.join(' | '),
            },
          });

          await reconcileAttendanceFinancialConsequences(tx, {
            employeeId: before.employeeId,
            date: before.date,
            before: {
              status: before.status,
              lateMinutes: before.lateMinutes,
              checkIn: before.checkIn,
              checkOut: before.checkOut,
              note: before.note,
            },
            after: {
              status: after.status,
              lateMinutes: after.lateMinutes,
              checkIn: after.checkIn,
              checkOut: after.checkOut,
              note: after.note,
            },
            dutyStartTimeSnapshot: before.dutyStartTimeSnapshot,
          });
        },
        { timeout: 60_000 },
      );

      updated++;

      const log = await prisma.attendanceLog.findUnique({
        where: { id: plan.id },
        select: { employeeId: true, date: true },
      });
      if (log) {
        await payrollService.recomputePendingPayrollForAttendanceDate(
          log.employeeId,
          log.date,
        );
      }

      if (updated % 50 === 0) {
        console.log(`… ${updated}/${plans.length} updated`);
      }
    } catch (err) {
      failed++;
      console.error(
        `FAILED ${plan.code} ${plan.date}: ${(err as Error).message}`,
      );
    }
  }

  console.log('\n--- Done ---');
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);
  console.log(
    'Missing-checkout discipline reversed where present; PENDING payroll recomputed per row.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
