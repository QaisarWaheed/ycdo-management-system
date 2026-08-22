/**
 * One-off cleanup for staff still hit by missing-checkout letters while
 * TEMPORARY_AUTO_CHECKOUT was not yet active on production.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/cleanup-temp-checkout-named.ts
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
import { reconcileAttendanceFinancialConsequences } from '../src/modules/attendance/discipline.helper';
import { computeShiftEndDateTime } from '../src/modules/attendance/shift-time.util';
import { TEMPORARY_AUTO_CHECKOUT_NOTE } from '../src/modules/attendance/temporary-auto-checkout';
import { PayrollService } from '../src/modules/payroll/payroll.service';
import { AccessScopeService } from '../src/modules/permissions/access-scope.service';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaClient();

const CODES = [
  'YCDO-2026-0107', // TAHA EJAZ
  'YCDO-2026-0169', // Muhammad Kamran
  'YCDO-2026-0019', // Dawood Ahmed
  'YCDO-2026-0394', // Humaira
  'YCDO-2026-0189', // Maryam
];

const SINCE = new Date('2026-08-20T00:00:00.000Z');

async function main() {
  const emps = await prisma.employee.findMany({
    where: { employeeCode: { in: CODES } },
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      dutyStartTime: true,
      dutyEndTime: true,
      dutyTotalHours: true,
      shift: { select: { name: true, startTime: true, endTime: true } },
    },
  });

  const payrollService = new PayrollService(
    prisma as unknown as PrismaService,
    {} as unknown as AccessScopeService,
  );

  let updated = 0;
  let lettersMarked = 0;

  for (const emp of emps) {
    if (is24HourShift(emp)) continue;

    const rows = await prisma.attendanceLog.findMany({
      where: {
        employeeId: emp.id,
        type: AttendanceLogType.REGULAR,
        date: { gte: SINCE },
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
    });

    for (const row of rows) {
      const duty = resolveAttendanceDutyTimes(row, emp);
      if (!duty.dutyStartTime || !duty.dutyEndTime) {
        console.log(
          'skip no duty',
          emp.employeeCode,
          row.date.toISOString().slice(0, 10),
        );
        continue;
      }
      const crosses = isOvernightShift(duty.dutyStartTime, duty.dutyEndTime);
      const checkOut = computeShiftEndDateTime(
        row.date,
        duty.dutyEndTime,
        crosses,
      );
      if (!row.checkIn || checkOut.getTime() <= row.checkIn.getTime()) {
        console.log(
          'skip invalid',
          emp.employeeCode,
          row.date.toISOString().slice(0, 10),
        );
        continue;
      }

      await prisma.$transaction(
        async (tx) => {
          const before = await tx.attendanceLog.findUnique({
            where: { id: row.id },
          });
          if (!before || before.checkOut != null || !before.checkIn) return;
          const noteParts = [
            before.note?.trim(),
            TEMPORARY_AUTO_CHECKOUT_NOTE,
          ].filter(Boolean);
          const after = await tx.attendanceLog.update({
            where: { id: row.id },
            data: {
              checkOut,
              sessionClosedAt: before.sessionClosedAt ?? new Date(),
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

      await payrollService.recomputePendingPayrollForAttendanceDate(
        emp.id,
        row.date,
      );
      updated++;
      console.log(
        'closed',
        emp.employeeCode,
        emp.fullName,
        row.date.toISOString().slice(0, 10),
        '->',
        checkOut.toISOString(),
      );
    }

    const letters = await prisma.letter.findMany({
      where: {
        employeeId: emp.id,
        generatedAt: { gte: new Date('2026-08-20T00:00:00+05:00') },
      },
    });
    for (const letter of letters) {
      const v = (letter.variables || {}) as Record<string, unknown>;
      if (typeof v.monthlyMissingCheckoutOccurrence !== 'number') continue;
      if (v.reversed === true) continue;
      await prisma.letter.update({
        where: { id: letter.id },
        data: {
          variables: {
            ...v,
            reversed: true,
            reversalTrigger: 'TEMPORARY_AUTO_CHECKOUT_CLEANUP',
            reversedAt: new Date().toISOString(),
          },
        },
      });
      lettersMarked++;
      console.log(
        'letter reversed',
        emp.employeeCode,
        letter.letterNo,
        letter.letterType,
      );
    }
  }

  console.log({ updated, lettersMarked });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
