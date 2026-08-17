/**
 * Phase 4B — one-time, controlled backfill of AttendanceLog.sessionClosedAt
 * for CURRENT-MONTH rows the live ShiftMissingCheckoutScheduler's own
 * [today, yesterday] window can never reach (it only ever looks at the last
 * two calendar days, by design — see shift-missing-checkout.scheduler.ts).
 *
 * A row within that window does NOT need this script: the scheduler will
 * pick it up and correctly set sessionClosedAt on its own next run (every
 * 15 minutes), reusing the exact same production code path.
 *
 * This script NEVER writes checkOut and NEVER (re-)invokes
 * applyMissingCheckoutDiscipline — only sessionClosedAt is backfilled, for
 * category C rows only, on the assumption that any row old enough to have
 * already passed through the scheduler's window while it was live has
 * already been correctly disciplined. It does not re-verify or re-run
 * discipline for old dates, to avoid interacting with current occurrence
 * counting in ways that would need separate, deliberate review.
 *
 * Usage:
 *   npx ts-node scripts/backfill-session-closure.ts            (dry run — report only)
 *   npx ts-node scripts/backfill-session-closure.ts --apply    (writes sessionClosedAt for category C rows)
 */
import { PrismaClient, AttendanceLogType } from '@prisma/client';
import { evaluateMissingCheckoutEligibility } from '../src/modules/attendance/shift-missing-checkout.scheduler';
import { toPakistanDateOnly } from '../src/modules/attendance/shift-time.util';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

type Category =
  | 'A_still_in_grace'
  | 'B_24h_staff'
  | 'C_eligible'
  | 'E_ambiguous';

async function main() {
  const now = new Date();
  const pkToday = toPakistanDateOnly(now);
  const pkYesterday = new Date(pkToday);
  pkYesterday.setUTCDate(pkYesterday.getUTCDate() - 1);
  const monthStart = new Date(pkToday.getFullYear(), pkToday.getMonth(), 1);

  const rows = await prisma.attendanceLog.findMany({
    where: {
      type: AttendanceLogType.REGULAR,
      date: { gte: monthStart, lte: pkToday },
      checkIn: { not: null },
      checkOut: null,
      sessionClosedAt: null,
    },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          status: true,
          dutyStartTime: true,
          dutyEndTime: true,
          dutyTotalHours: true,
          shift: { select: { name: true, startTime: true, endTime: true } },
        },
      },
    },
    orderBy: { date: 'asc' },
  });

  const counts: Record<Category, number> = {
    A_still_in_grace: 0,
    B_24h_staff: 0,
    C_eligible: 0,
    E_ambiguous: 0,
  };
  const categoryC: typeof rows = [];
  const withinSchedulerWindow: typeof rows = [];

  for (const row of rows) {
    const inSchedulerWindow =
      row.date.getTime() === pkToday.getTime() ||
      row.date.getTime() === pkYesterday.getTime();
    if (inSchedulerWindow) {
      // Not this script's responsibility — the live scheduler already
      // covers these dates on its own next run.
      withinSchedulerWindow.push(row);
      continue;
    }

    const employee = row.employee;
    if (
      !employee ||
      (employee.status !== 'ACTIVE' &&
        employee.status !== 'APPOINTED' &&
        employee.status !== 'TRAINEE')
    ) {
      counts.E_ambiguous++;
      console.log(
        `[E ambiguous] ${row.id} employee=${employee?.employeeCode ?? row.employeeId} date=${row.date.toISOString().slice(0, 10)} — employee missing or not active/appointed/trainee; skipped, needs manual review`,
      );
      continue;
    }

    const evaluation = evaluateMissingCheckoutEligibility(
      employee,
      row.date,
      now,
    );

    if (evaluation.eligible === false) {
      if (evaluation.reason.includes('24-hour')) {
        counts.B_24h_staff++;
      } else if (evaluation.reason.includes('grace')) {
        counts.A_still_in_grace++;
        console.log(
          `[A still-in-grace — UNEXPECTED for a row this old] ${row.id} employee=${employee.employeeCode} date=${row.date.toISOString().slice(0, 10)} — flagging for manual review, not touched`,
        );
      } else {
        counts.E_ambiguous++;
        console.log(
          `[E ambiguous] ${row.id} employee=${employee.employeeCode} date=${row.date.toISOString().slice(0, 10)} — ${evaluation.reason}; skipped, needs manual review`,
        );
      }
      continue;
    }

    counts.C_eligible++;
    categoryC.push(row);
    console.log(
      `[C eligible] ${row.id} employee=${employee.employeeCode} (${employee.fullName}) date=${row.date.toISOString().slice(0, 10)} checkIn=${row.checkIn?.toISOString()} — ${Math.round(evaluation.minutesPastEnd)}min past shift end+grace`,
    );
  }

  console.log('\n--- Summary ---');
  console.log(
    `Total open rows scanned (current month, excluding today/yesterday): ${rows.length - withinSchedulerWindow.length}`,
  );
  console.log(
    `Within live scheduler's own window (today/yesterday) — left for it to handle: ${withinSchedulerWindow.length}`,
  );
  console.log(
    `A (still in grace — unexpected for an old row, needs review): ${counts.A_still_in_grace}`,
  );
  console.log(
    `B (24-hour staff — correctly excluded, never closed): ${counts.B_24h_staff}`,
  );
  console.log(
    `C (eligible for sessionClosedAt backfill): ${counts.C_eligible}`,
  );
  console.log(
    `E (ambiguous — left untouched, needs manual HR/IT review): ${counts.E_ambiguous}`,
  );

  if (!APPLY) {
    console.log(
      '\nDry run only — no rows were modified. Re-run with --apply to backfill sessionClosedAt for the C rows listed above.',
    );
    return;
  }

  if (categoryC.length === 0) {
    console.log('\nNothing to apply — no category C rows found.');
    return;
  }

  const applyNow = new Date();
  for (const row of categoryC) {
    await prisma.attendanceLog.update({
      where: { id: row.id },
      data: { sessionClosedAt: applyNow },
    });
  }
  console.log(
    `\nApplied: sessionClosedAt set for ${categoryC.length} row(s). checkOut was NOT touched. Discipline was NOT re-run.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
