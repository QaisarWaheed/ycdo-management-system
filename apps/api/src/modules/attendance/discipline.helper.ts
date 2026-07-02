import {
  AttendanceStatus,
  DeductionType,
  EmployeeStatus,
  LeaveStatus,
  LetterType,
  Prisma,
} from '@prisma/client';
import { calculateLateMinutes } from './attendance-late.util';

export { calculateLateMinutes };

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

  if (status === AttendanceStatus.LATE && lateMinutes > 60) {
    await applyHalfDayLateDeduction(tx, employeeId, date, lateMinutes);
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

async function applyHalfDayLateDeduction(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  lateMinutes: number,
): Promise<void> {
  const basicStipend = await getBasicStipend(tx, employeeId);
  if (basicStipend <= 0) return;

  const deductionAmount = basicStipend / 30 / 2;
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
      reason: DeductionType.LATE_ARRIVAL,
      amount: deductionAmount,
      description: `Half day deduction - late arrival over 1 hour (${lateMinutes} min)`,
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
        'You have been marked as Half Day due to late arrival of more than 1 hour. Half day stipend has been deducted.',
      type: 'HALF_DAY_DEDUCTION',
    },
  });
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

  const lateCount = await tx.attendanceLog.count({
    where: {
      employeeId,
      status: AttendanceStatus.LATE,
      date: { gte: startOfMonth, lte: endOfMonth },
    },
  });

  if (lateCount % 3 === 0) {
    const deductionAmount = basicStipend / 30;
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

  return tx.payrollEntry.create({
    data: {
      stipendRecordId: stipendRecord.id,
      month,
      year,
      basicStipend: stipendRecord.basicStipend,
      netStipend: stipendRecord.basicStipend,
      totalDeductions: 0,
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
