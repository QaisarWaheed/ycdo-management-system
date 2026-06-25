import {
  AttendanceStatus,
  DeductionType,
  EmployeeStatus,
  LetterType,
  Prisma,
} from '@prisma/client';

export async function applyDisciplineRules(
  tx: Prisma.TransactionClient,
  employeeId: string,
  status: AttendanceStatus,
  date: Date,
): Promise<void> {
  if (
    status !== AttendanceStatus.LATE &&
    status !== AttendanceStatus.UNINFORMED_ABSENT
  ) {
    return;
  }

  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    include: {
      stipendRecords: {
        where: { effectiveTo: null },
        take: 1,
      },
    },
  });

  const basicStipend = Number(employee?.stipendRecords[0]?.basicStipend ?? 0);

  if (status === AttendanceStatus.LATE) {
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

  if (status === AttendanceStatus.UNINFORMED_ABSENT && basicStipend > 0) {
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
