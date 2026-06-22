import {
  AttendanceStatus,
  DeductionType,
  DisciplinaryType,
  Prisma,
} from '@prisma/client';

export async function applyDisciplineRules(
  tx: Prisma.TransactionClient,
  employeeId: string,
  status: AttendanceStatus,
  date: Date,
): Promise<void> {
  if (status !== AttendanceStatus.LATE && status !== AttendanceStatus.UNINFORMED_ABSENT) {
    return;
  }

  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    include: {
      salaryRecords: {
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
      },
    },
  });

  if (!employee || employee.salaryRecords.length === 0) {
    return;
  }

  const salaryRecord = employee.salaryRecords[0];
  const basicSalary = Number(salaryRecord.basicSalary);
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  let payrollEntry = await tx.payrollEntry.findUnique({
    where: {
      salaryRecordId_month_year: {
        salaryRecordId: salaryRecord.id,
        month,
        year,
      },
    },
  });

  if (!payrollEntry) {
    payrollEntry = await tx.payrollEntry.create({
      data: {
        salaryRecordId: salaryRecord.id,
        month,
        year,
        basicSalary: salaryRecord.basicSalary,
        netSalary: salaryRecord.basicSalary,
        totalDeductions: 0,
        status: 'PENDING',
      },
    });
  }

  if (status === AttendanceStatus.LATE) {
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0);

    const lateCount = await tx.attendanceLog.count({
      where: {
        employeeId,
        status: AttendanceStatus.LATE,
        date: { gte: startOfMonth, lte: endOfMonth },
      },
    });

    if (lateCount === 1) {
      await tx.notification.create({
        data: {
          employeeId,
          type: 'LATE_WARNING',
          message: 'Late arrival warning - Day 1',
        },
      });
    } else if (lateCount === 2) {
      await tx.disciplinaryAction.create({
        data: {
          employeeId,
          type: DisciplinaryType.WARNING,
          reason: 'Second late arrival this month',
        },
      });
    } else if (lateCount >= 3) {
      const deductionAmount = basicSalary / 30;

      await tx.disciplinaryAction.create({
        data: {
          employeeId,
          type: DisciplinaryType.FINE,
          reason: `Late arrival - day ${lateCount} this month`,
        },
      });

      await tx.payrollDeduction.create({
        data: {
          payrollEntryId: payrollEntry.id,
          reason: DeductionType.LATE_ARRIVAL,
          amount: deductionAmount,
        },
      });

      await tx.payrollEntry.update({
        where: { id: payrollEntry.id },
        data: {
          totalDeductions: Number(payrollEntry.totalDeductions) + deductionAmount,
          netSalary: Number(payrollEntry.netSalary) - deductionAmount,
        },
      });
    }
  }

  if (status === AttendanceStatus.UNINFORMED_ABSENT) {
    const deductionAmount = (basicSalary / 30) * 2;

    await tx.disciplinaryAction.create({
      data: {
        employeeId,
        type: DisciplinaryType.FINE,
        reason: 'Uninformed absence',
      },
    });

    await tx.payrollDeduction.create({
      data: {
        payrollEntryId: payrollEntry.id,
        reason: DeductionType.UNINFORMED_ABSENCE,
        amount: deductionAmount,
      },
    });

    await tx.payrollEntry.update({
      where: { id: payrollEntry.id },
      data: {
        totalDeductions: Number(payrollEntry.totalDeductions) + deductionAmount,
        netSalary: Number(payrollEntry.netSalary) - deductionAmount,
      },
    });
  }
}
