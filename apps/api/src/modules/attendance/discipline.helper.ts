import {
  AttendanceStatus,
  DeductionType,
  EmployeeStatus,
  LeaveStatus,
  LetterType,
  Prisma,
} from '@prisma/client';
import { stipendRecordToPackage } from '../../common/stipend.util';

export type DisciplineOptions = {
  lateMinutes?: number;
};

export async function applyDisciplineRules(
  tx: Prisma.TransactionClient,
  employeeId: string,
  status: AttendanceStatus,
  date: Date,
  options: DisciplineOptions = {},
): Promise<AttendanceStatus> {
  const lateMinutes = options.lateMinutes ?? 0;

  // Late > 1 hour is recorded as HALF_DAY for attendance display only.
  // Pay is reduced naturally by unpaid hours; cash penalties apply only at
  // the 3rd / 6th / 9th late occurrence via applyLateDiscipline.
  if (status === AttendanceStatus.LATE && lateMinutes > 60) {
    await applyLateDiscipline(tx, employeeId, date);
    return AttendanceStatus.HALF_DAY;
  }

  if (status === AttendanceStatus.ABSENT) {
    await applyAbsentDeduction(tx, employeeId, date);
    return status;
  }

  if (status === AttendanceStatus.LATE) {
    await applyLateDiscipline(tx, employeeId, date);
    return status;
  }

  if (status === AttendanceStatus.UNINFORMED_ABSENT) {
    await applyUninformedAbsentDeduction(tx, employeeId, date);
    return status;
  }

  return status;
}

async function getBasicStipend(
  tx: Prisma.TransactionClient,
  employeeId: string,
): Promise<number> {
  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    include: {
      stipendRecords: {
        where: { effectiveTo: null },
        take: 1,
      },
    },
  });

  return Number(employee?.stipendRecords[0]?.basicStipend ?? 0);
}

async function applyAbsentDeduction(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<void> {
  const approvedLeave = await tx.leaveRecord.findFirst({
    where: {
      employeeId,
      status: LeaveStatus.APPROVED,
      startDate: { lte: date },
      endDate: { gte: date },
    },
  });

  if (approvedLeave) return;

  const basicStipend = await getBasicStipend(tx, employeeId);
  if (basicStipend <= 0) return;

  const deductionAmount = (basicStipend / 30) * 2;
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const payrollEntry = await getOrCreatePayrollEntry(
    tx,
    employeeId,
    month,
    year,
  );

  await tx.payrollDeduction.create({
    data: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.UNINFORMED_ABSENCE,
      amount: deductionAmount,
      description: 'Absent without approved leave (2 days stipend)',
    },
  });

  await tx.payrollEntry.update({
    where: { id: payrollEntry.id },
    data: {
      totalDeductions: { increment: deductionAmount },
      netStipend: { decrement: deductionAmount },
    },
  });

  await tx.notification.create({
    data: {
      employeeId,
      message:
        'You have been marked absent. 2 days stipend has been deducted from your monthly stipend.',
      type: 'ABSENT_DEDUCTION',
    },
  });
}

async function applyLateDiscipline(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<void> {
  const basicStipend = await getBasicStipend(tx, employeeId);
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);

  // Count LATE and late-driven HALF_DAY days. Short-leave HALF_DAY is excluded.
  // Include the current day even if the log has not been written yet.
  const priorLateDays = await tx.attendanceLog.findMany({
    where: {
      employeeId,
      date: { gte: startOfMonth, lte: endOfMonth },
      OR: [
        { status: AttendanceStatus.LATE },
        {
          status: AttendanceStatus.HALF_DAY,
          NOT: {
            note: { contains: 'short leave', mode: 'insensitive' },
          },
          lateMinutes: { gt: 0 },
        },
      ],
    },
    select: { date: true },
  });

  const uniqueDays = new Set(
    priorLateDays.map((row) => row.date.toISOString().slice(0, 10)),
  );
  uniqueDays.add(dayStart.toISOString().slice(0, 10));
  const lateCount = uniqueDays.size;

  if (lateCount === 3 || lateCount === 6 || lateCount === 9) {
    const deductionAmount = basicStipend / 30;
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const payrollEntry = await getOrCreatePayrollEntry(
      tx,
      employeeId,
      month,
      year,
    );

    const alreadyDeducted = await tx.payrollDeduction.findFirst({
      where: {
        payrollEntryId: payrollEntry.id,
        reason: DeductionType.LATE_ARRIVAL,
        description: {
          contains: `${lateCount} late`,
        },
      },
    });

    if (!alreadyDeducted && basicStipend > 0) {
      await tx.payrollDeduction.create({
        data: {
          payrollEntryId: payrollEntry.id,
          reason: DeductionType.LATE_ARRIVAL,
          amount: deductionAmount,
          description: `Late arrival deduction (${lateCount} lates this month)`,
        },
      });

      await tx.payrollEntry.update({
        where: { id: payrollEntry.id },
        data: {
          totalDeductions: { increment: deductionAmount },
          netStipend: { decrement: deductionAmount },
        },
      });
    }

    if (lateCount === 3) {
      await autoGenerateLateWarningLetter(tx, employeeId, 1, lateCount);
    } else if (lateCount === 6) {
      await autoGenerateLateWarningLetter(tx, employeeId, 2, lateCount);
    } else if (lateCount === 9) {
      await autoGenerateLateWarningLetter(tx, employeeId, 3, lateCount);
      await tx.employee.update({
        where: { id: employeeId },
        data: { status: EmployeeStatus.SUSPENDED },
      });
      await tx.user.updateMany({
        where: { employeeId },
        data: { isActive: false },
      });
    }
  } else {
    await tx.notification.create({
      data: {
        employeeId,
        message: `Late arrival recorded. You have been late ${lateCount} time(s) this month.`,
        type: 'LATE_WARNING',
      },
    });
  }
}

async function applyUninformedAbsentDeduction(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<void> {
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const dayKey = date.toISOString().slice(0, 10);

  // Count unique uninformed-absent days this month, including the current day
  // (the attendance log may not be written yet when discipline runs).
  const priorDays = await tx.attendanceLog.findMany({
    where: {
      employeeId,
      date: { gte: startOfMonth, lte: endOfMonth },
      status: AttendanceStatus.UNINFORMED_ABSENT,
    },
    select: { date: true },
  });

  const uniqueDays = new Set(
    priorDays.map((row) => row.date.toISOString().slice(0, 10)),
  );
  uniqueDays.add(dayKey);
  const uninformedCount = uniqueDays.size;

  const basicStipend = await getBasicStipend(tx, employeeId);
  if (basicStipend > 0) {
    const deductionAmount = (basicStipend / 30) * 2;
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const payrollEntry = await getOrCreatePayrollEntry(
      tx,
      employeeId,
      month,
      year,
    );

    await tx.payrollDeduction.create({
      data: {
        payrollEntryId: payrollEntry.id,
        reason: DeductionType.UNINFORMED_ABSENCE,
        amount: deductionAmount,
        description: 'Uninformed absence deduction (2 days)',
      },
    });

    await tx.payrollEntry.update({
      where: { id: payrollEntry.id },
      data: {
        totalDeductions: { increment: deductionAmount },
        netStipend: { decrement: deductionAmount },
      },
    });
  }

  // More than 2 uninformed-absent days in a month → automatic suspension.
  if (uninformedCount > 2) {
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      select: { status: true },
    });

    if (employee?.status !== EmployeeStatus.SUSPENDED) {
      await tx.employee.update({
        where: { id: employeeId },
        data: { status: EmployeeStatus.SUSPENDED },
      });
      await tx.user.updateMany({
        where: { employeeId },
        data: { isActive: false },
      });

      await tx.notification.create({
        data: {
          employeeId,
          message: `You have been suspended due to ${uninformedCount} uninformed absence day(s) this month (more than 2 days). Please contact HR.`,
          type: 'SUSPENSION_ISSUED',
        },
      });
    }
  }
}

async function getOrCreatePayrollEntry(
  tx: Prisma.TransactionClient,
  employeeId: string,
  month: number,
  year: number,
) {
  const stipendRecord = await tx.stipendRecord.findFirst({
    where: { employeeId, effectiveTo: null },
    orderBy: { effectiveFrom: 'desc' },
  });

  if (!stipendRecord) {
    throw new Error(`No active stipend record for employee ${employeeId}`);
  }

  const existing = await tx.payrollEntry.findUnique({
    where: {
      stipendRecordId_month_year: {
        stipendRecordId: stipendRecord.id,
        month,
        year,
      },
    },
  });

  if (existing) {
    return existing;
  }

  const pkg = stipendRecordToPackage(stipendRecord);
  const fixedAllowances =
    (pkg.allowances || 0) +
    (pkg.reward || 0) +
    (pkg.progressReward || 0) +
    (pkg.fuelAllowance || 0);
  const fixedDeductions =
    (pkg.loanDeduction || 0) +
    (pkg.advanceDeduction || 0) +
    (pkg.fineDeduction || 0) +
    (pkg.healthDeduction || 0);

  return tx.payrollEntry.create({
    data: {
      stipendRecordId: stipendRecord.id,
      month,
      year,
      // Placeholder until hourly recalculation runs for the pending entry.
      basicStipend: pkg.basicStipend,
      totalAllowances: fixedAllowances,
      totalDeductions: fixedDeductions,
      netStipend: pkg.lumpsumTotal,
      status: 'PENDING',
    },
  });
}

async function autoGenerateLateWarningLetter(
  tx: Prisma.TransactionClient,
  employeeId: string,
  warningNumber: number,
  lateCount: number,
): Promise<void> {
  const letterType =
    warningNumber === 3 ? LetterType.SUSPENSION : LetterType.WARNING;

  const existingLetter = await tx.letter.findFirst({
    where: {
      employeeId,
      letterType,
      generatedAt: {
        gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
    },
  });
  if (existingLetter) return;

  const letterCount = await tx.letter.count({
    where: { letterType },
  });

  const typeShort = warningNumber === 3 ? 'SUS' : 'WRN';
  const refNumber = `YCDO-${typeShort}-${new Date().getFullYear()}-${String(letterCount + 1).padStart(4, '0')}`;

  const content = {
    refNumber,
    warningNumber,
    lateCount,
    reason: `Late arrival ${lateCount} times this month`,
    incidentDate: new Date().toISOString(),
  };

  await tx.letter.create({
    data: {
      employeeId,
      letterType,
      content,
      requiresAcknowledgement: true,
      replyDeadline:
        letterType === LetterType.SUSPENSION
          ? null
          : new Date(Date.now() + 48 * 60 * 60 * 1000),
      fileUrl: null,
    },
  });

  await tx.notification.create({
    data: {
      employeeId,
      message:
        warningNumber === 3
          ? 'You have been suspended due to repeated late arrivals (9 lates this month).'
          : `Warning Letter ${warningNumber} has been issued due to ${lateCount} late arrivals this month.`,
      type: warningNumber === 3 ? 'SUSPENSION_ISSUED' : 'WARNING_ISSUED',
    },
  });
}
