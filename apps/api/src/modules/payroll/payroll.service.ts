import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayrollStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AddDeductionDto,
  AddAllowanceDto,
  CreatePayrollEntryDto,
  PayrollQueryDto,
  SalaryIncrementDto,
  UpdatePayrollStatusDto,
} from './payroll.dto';

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  async createOrGetEntry(dto: CreatePayrollEntryDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: {
        salaryRecords: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    const activeSalaryRecord = employee.salaryRecords[0];
    if (!activeSalaryRecord) {
      throw new NotFoundException(
        `No active salary record found for employee ${dto.employeeId}`,
      );
    }

    const existing = await this.prisma.payrollEntry.findUnique({
      where: {
        salaryRecordId_month_year: {
          salaryRecordId: activeSalaryRecord.id,
          month: dto.month,
          year: dto.year,
        },
      },
      include: { deductions: true },
    });

    if (existing) {
      return existing;
    }

    const basicSalary =
      dto.basicSalary ?? Number(activeSalaryRecord.basicSalary);
    const totalAllowances = dto.totalAllowances ?? 0;
    const netSalary = basicSalary + totalAllowances;

    return this.prisma.payrollEntry.create({
      data: {
        salaryRecordId: activeSalaryRecord.id,
        month: dto.month,
        year: dto.year,
        basicSalary,
        totalAllowances,
        totalDeductions: 0,
        netSalary,
        status: PayrollStatus.PENDING,
      },
      include: { deductions: true },
    });
  }

  async addDeduction(dto: AddDeductionDto) {
    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: dto.payrollEntryId },
    });

    if (!entry) {
      throw new NotFoundException(
        `Payroll entry with id ${dto.payrollEntryId} not found`,
      );
    }

    if (
      entry.status === PayrollStatus.PROCESSED ||
      entry.status === PayrollStatus.PAID
    ) {
      throw new BadRequestException(
        'Cannot add deductions to processed or paid payroll entries',
      );
    }

    await this.prisma.payrollDeduction.create({
      data: {
        payrollEntryId: dto.payrollEntryId,
        reason: dto.reason,
        amount: dto.amount,
        description: dto.description,
      },
    });

    return this.prisma.payrollEntry.update({
      where: { id: dto.payrollEntryId },
      data: {
        totalDeductions: Number(entry.totalDeductions) + dto.amount,
        netSalary: Number(entry.netSalary) - dto.amount,
      },
      include: { deductions: true },
    });
  }

  async updateStatus(
    entryId: string,
    dto: UpdatePayrollStatusDto,
    actingUserId: string,
  ) {
    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: entryId },
    });

    if (!entry) {
      throw new NotFoundException(
        `Payroll entry with id ${entryId} not found`,
      );
    }

    this.validateStatusTransition(entry.status, dto.status);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payrollEntry.update({
        where: { id: entryId },
        data: {
          status: dto.status,
          processedAt:
            dto.status === PayrollStatus.PROCESSED ? new Date() : undefined,
        },
        include: { deductions: true },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'PAYROLL_STATUS_CHANGED',
          entity: 'PayrollEntry',
          entityId: entryId,
          changes: { from: entry.status, to: dto.status },
        },
      });

      return result;
    });

    return updated;
  }

  async addAllowance(dto: AddAllowanceDto) {
    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: dto.payrollEntryId },
    });

    if (!entry) {
      throw new NotFoundException(
        `Payroll entry with id ${dto.payrollEntryId} not found`,
      );
    }

    if (
      entry.status === PayrollStatus.PROCESSED ||
      entry.status === PayrollStatus.PAID
    ) {
      throw new BadRequestException(
        'Cannot add allowances to processed or paid payroll entries',
      );
    }

    await this.prisma.allowance.create({
      data: {
        payrollEntryId: dto.payrollEntryId,
        type: dto.type,
        description: dto.description,
        amount: dto.amount,
        hours: dto.hours,
      },
    });

    return this.prisma.payrollEntry.update({
      where: { id: dto.payrollEntryId },
      data: {
        totalAllowances: Number(entry.totalAllowances) + dto.amount,
        netSalary: Number(entry.netSalary) + dto.amount,
      },
      include: { deductions: true, allowances: true },
    });
  }

  async getEntryWithAllowances(entryId: string) {
    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: entryId },
      include: {
        deductions: true,
        allowances: true,
        salaryRecord: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
                currentBranch: { select: { id: true, name: true } },
                currentDepartment: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(
        `Payroll entry with id ${entryId} not found`,
      );
    }

    const relieverSummary = await this.prisma.relieverSession.aggregate({
      where: {
        employeeId: entry.salaryRecord.employeeId,
        date: {
          gte: new Date(entry.year, entry.month - 1, 1),
          lte: new Date(entry.year, entry.month, 0),
        },
      },
      _sum: { totalMinutes: true },
    });

    const totalRelieverMinutes = relieverSummary._sum.totalMinutes ?? 0;

    return {
      ...entry,
      totalRelieverHours: Math.round((totalRelieverMinutes / 60) * 100) / 100,
    };
  }

  findAll(query: PayrollQueryDto) {
    const year = query.year ?? new Date().getFullYear();
    const where: Prisma.PayrollEntryWhereInput = { year };

    if (query.month) {
      where.month = query.month;
    }

    if (query.status) {
      where.status = query.status;
    }

    const employeeFilter: Prisma.EmployeeWhereInput = {};

    if (query.employeeId) {
      employeeFilter.id = query.employeeId;
    }

    if (query.branchId) {
      employeeFilter.currentBranchId = query.branchId;
    }

    if (query.departmentId) {
      employeeFilter.currentDepartmentId = query.departmentId;
    }

    if (Object.keys(employeeFilter).length > 0) {
      where.salaryRecord = { employee: employeeFilter };
    }

    return this.prisma.payrollEntry.findMany({
      where,
      include: {
        deductions: true,
        salaryRecord: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
                currentBranch: { select: { id: true, name: true } },
                currentDepartment: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async findOne(entryId: string) {
    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: entryId },
      include: {
        deductions: true,
        salaryRecord: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
                currentBranch: { select: { id: true, name: true } },
                currentDepartment: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(
        `Payroll entry with id ${entryId} not found`,
      );
    }

    return entry;
  }

  async getEmployeePayrollHistory(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${employeeId} not found`,
      );
    }

    return this.prisma.payrollEntry.findMany({
      where: {
        salaryRecord: { employeeId },
      },
      include: { deductions: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async getMonthlyPayrollSummary(
    month: number,
    year: number,
    branchId?: string,
  ) {
    const where: Prisma.PayrollEntryWhereInput = { month, year };

    if (branchId) {
      where.salaryRecord = {
        employee: { currentBranchId: branchId },
      };
    }

    const entries = await this.prisma.payrollEntry.findMany({ where });

    const byStatus = {
      PENDING: 0,
      PROCESSED: 0,
      PAID: 0,
    };

    let totalBasicSalary = 0;
    let totalDeductions = 0;
    let totalAllowances = 0;
    let totalNetSalary = 0;

    for (const entry of entries) {
      byStatus[entry.status]++;
      totalBasicSalary += Number(entry.basicSalary);
      totalDeductions += Number(entry.totalDeductions);
      totalAllowances += Number(entry.totalAllowances);
      totalNetSalary += Number(entry.netSalary);
    }

    return {
      month,
      year,
      totalEmployees: entries.length,
      totalBasicSalary,
      totalDeductions,
      totalAllowances,
      totalNetSalary,
      byStatus,
    };
  }

  async salaryIncrement(dto: SalaryIncrementDto, actingUserId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: {
        salaryRecords: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    const activeSalaryRecord = employee.salaryRecords[0];
    if (!activeSalaryRecord) {
      throw new NotFoundException(
        `No active salary record found for employee ${dto.employeeId}`,
      );
    }

    const effectiveFrom = new Date(dto.effectiveFrom);
    const previousSalary = Number(activeSalaryRecord.basicSalary);

    return this.prisma.$transaction(async (tx) => {
      await tx.salaryRecord.update({
        where: { id: activeSalaryRecord.id },
        data: { effectiveTo: effectiveFrom },
      });

      const newRecord = await tx.salaryRecord.create({
        data: {
          employeeId: dto.employeeId,
          basicSalary: dto.newBasicSalary,
          effectiveFrom,
        },
      });

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'SALARY_INCREMENT',
          message: `Your salary has been updated to PKR ${dto.newBasicSalary} effective ${effectiveFrom.toISOString().split('T')[0]}`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'SALARY_INCREMENT',
          entity: 'SalaryRecord',
          entityId: newRecord.id,
          changes: {
            previousSalary,
            newSalary: dto.newBasicSalary,
            reason: dto.reason,
          },
        },
      });

      return newRecord;
    });
  }

  private validateStatusTransition(
    current: PayrollStatus,
    next: PayrollStatus,
  ): void {
    if (next === PayrollStatus.PENDING) {
      throw new BadRequestException('Cannot revert payroll entry to pending');
    }

    if (
      current === PayrollStatus.PENDING &&
      next === PayrollStatus.PROCESSED
    ) {
      return;
    }

    if (current === PayrollStatus.PROCESSED && next === PayrollStatus.PAID) {
      return;
    }

    if (current === PayrollStatus.PENDING && next === PayrollStatus.PAID) {
      throw new BadRequestException(
        'Payroll must be processed before it can be marked as paid',
      );
    }

    throw new BadRequestException(
      `Invalid status transition from ${current} to ${next}`,
    );
  }
}
