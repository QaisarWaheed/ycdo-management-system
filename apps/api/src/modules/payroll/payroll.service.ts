import {
  calculateLumpsumTotal,
  stipendRecordToPackage,
} from '../../common/stipend.util';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Permission, PayrollStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScopeService } from '../permissions/access-scope.service';
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
  constructor(
    private prisma: PrismaService,
    private accessScopeService: AccessScopeService,
  ) {}

  async createOrGetEntry(
    dto: CreatePayrollEntryDto,
    actingUser?: { id: string; role: UserRole },
  ) {
    if (actingUser?.id) {
      await this.accessScopeService.assertEmployeeAccess(
        actingUser.id,
        actingUser.role,
        Permission.PAYROLL_MANAGE,
        dto.employeeId,
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: {
        stipendRecords: {
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

    const activeStipendRecord = employee.stipendRecords[0];
    if (!activeStipendRecord) {
      throw new NotFoundException(
        `No active stipend record found for employee ${dto.employeeId}`,
      );
    }

    const existing = await this.prisma.payrollEntry.findUnique({
      where: {
        stipendRecordId_month_year: {
          stipendRecordId: activeStipendRecord.id,
          month: dto.month,
          year: dto.year,
        },
      },
      include: { deductions: true },
    });

    if (existing) {
      return existing;
    }

    const pkg = stipendRecordToPackage(activeStipendRecord);
    const basicStipend = dto.basicStipend ?? pkg.basicStipend;
    const totalAllowances =
      dto.totalAllowances ??
      (pkg.allowances || 0) +
        (pkg.reward || 0) +
        (pkg.progressReward || 0) +
        (pkg.fuelAllowance || 0);
    const fixedDeductions =
      (pkg.loanDeduction || 0) +
      (pkg.advanceDeduction || 0) +
      (pkg.fineDeduction || 0) +
      (pkg.healthDeduction || 0);
    const netStipend = pkg.lumpsumTotal;

    return this.prisma.payrollEntry.create({
      data: {
        stipendRecordId: activeStipendRecord.id,
        month: dto.month,
        year: dto.year,
        basicStipend,
        totalAllowances,
        totalDeductions: fixedDeductions,
        netStipend,
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
        netStipend: Number(entry.netStipend) - dto.amount,
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
        netStipend: Number(entry.netStipend) + dto.amount,
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
        stipendRecord: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                currentBranch: { select: { id: true, name: true, address: true } },
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
        employeeId: entry.stipendRecord.employeeId,
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

  async findAll(
    query: PayrollQueryDto,
    actingUser?: { id: string; role: UserRole },
  ) {
    const year = query.year ?? new Date().getFullYear();
    const where: Prisma.PayrollEntryWhereInput = { year };

    if (query.month) {
      where.month = query.month;
    }

    if (query.status) {
      where.status = query.status;
    }

    let employeeFilter: Prisma.EmployeeWhereInput = {};

    if (query.employeeId) {
      employeeFilter.id = query.employeeId;
    }

    if (query.branchId) {
      employeeFilter.currentBranchId = query.branchId;
    }

    if (query.departmentId) {
      employeeFilter.currentDepartmentId = query.departmentId;
    }

    if (actingUser?.id) {
      employeeFilter =
        await this.accessScopeService.narrowEmployeeWhereForActor(
          actingUser.id,
          actingUser.role,
          employeeFilter,
        );
    }

    if (Object.keys(employeeFilter).length > 0) {
      where.stipendRecord = { employee: employeeFilter };
    }

    return this.prisma.payrollEntry.findMany({
      where,
      include: {
        deductions: true,
        stipendRecord: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                currentBranch: { select: { id: true, name: true, address: true } },
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
        stipendRecord: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                currentBranch: { select: { id: true, name: true, address: true } },
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
        stipendRecord: { employeeId },
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
      where.stipendRecord = {
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
      totalBasicSalary += Number(entry.basicStipend);
      totalDeductions += Number(entry.totalDeductions);
      totalAllowances += Number(entry.totalAllowances);
      totalNetSalary += Number(entry.netStipend);
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
        stipendRecords: {
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

    const activeStipendRecord = employee.stipendRecords[0];
    if (!activeStipendRecord) {
      throw new NotFoundException(
        `No active stipend record found for employee ${dto.employeeId}`,
      );
    }

    const effectiveFrom = new Date(dto.effectiveFrom);
    const previousSalary = Number(activeStipendRecord.basicStipend);
    const lumpsumTotal = calculateLumpsumTotal({
      basicStipend: dto.basicStipend,
      allowances: dto.allowances,
      reward: dto.reward,
      progressReward: dto.progressReward,
      fuelAllowance: dto.fuelAllowance,
      loanDeduction: dto.loanDeduction,
      advanceDeduction: dto.advanceDeduction,
      fineDeduction: dto.fineDeduction,
      healthDeduction: dto.healthDeduction,
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.stipendRecord.update({
        where: { id: activeStipendRecord.id },
        data: { effectiveTo: effectiveFrom },
      });

      const newRecord = await tx.stipendRecord.create({
        data: {
          employeeId: dto.employeeId,
          basicStipend: dto.basicStipend,
          allowances: dto.allowances ?? 0,
          reward: dto.reward ?? 0,
          progressReward: dto.progressReward ?? 0,
          fuelAllowance: dto.fuelAllowance ?? 0,
          loanDeduction: dto.loanDeduction ?? 0,
          advanceDeduction: dto.advanceDeduction ?? 0,
          fineDeduction: dto.fineDeduction ?? 0,
          healthDeduction: dto.healthDeduction ?? 0,
          lumpsumTotal,
          effectiveFrom,
        },
      });

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'SALARY_INCREMENT',
          message: `Your stipend package has been updated to PKR ${lumpsumTotal} (lumpsum) effective ${effectiveFrom.toISOString().split('T')[0]}`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'SALARY_INCREMENT',
          entity: 'StipendRecord',
          entityId: newRecord.id,
          changes: {
            previousSalary,
            newBasicStipend: dto.basicStipend,
            lumpsumTotal,
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
