import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllowanceType,
  EmployeeStatus,
  Permission,
  PayrollStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScopeService } from '../permissions/access-scope.service';
import {
  CreateIncentiveDto,
  incentiveAllowanceDescription,
  IncentiveQueryDto,
  isIncentiveAllowance,
} from './incentives.dto';

@Injectable()
export class IncentivesService {
  constructor(
    private prisma: PrismaService,
    private accessScopeService: AccessScopeService,
  ) {}

  async create(
    dto: CreateIncentiveDto,
    addedById: string,
    actingRole: UserRole = UserRole.HR_MANAGER,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Reason is required for incentives');
    }

    await this.accessScopeService.assertEmployeeAccess(
      addedById,
      actingRole,
      Permission.INCENTIVES_MANAGE,
      dto.employeeId,
    );

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    if (
      employee.status !== EmployeeStatus.ACTIVE &&
      employee.status !== EmployeeStatus.APPOINTED
    ) {
      throw new BadRequestException(
        'Incentives can only be added for active or appointed employees',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const incentive = await tx.incentive.create({
        data: {
          employeeId: dto.employeeId,
          amount: dto.amount,
          reason: dto.reason.trim(),
          addedBy: addedById,
          month: dto.month,
          year: dto.year,
        },
      });

      const payrollEntry = await this.getOrCreatePayrollEntry(
        tx,
        dto.employeeId,
        dto.month,
        dto.year,
      );

      await tx.allowance.create({
        data: {
          payrollEntryId: payrollEntry.id,
          type: AllowanceType.CUSTOM,
          description: incentiveAllowanceDescription(dto.reason.trim()),
          amount: dto.amount,
        },
      });

      await tx.payrollEntry.update({
        where: { id: payrollEntry.id },
        data: {
          totalAllowances: { increment: dto.amount },
          netStipend: { increment: dto.amount },
        },
      });

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'INCENTIVE_ADDED',
          message: `You have received an incentive of PKR ${dto.amount} for ${dto.month}/${dto.year}. Reason: ${dto.reason.trim()}`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: addedById,
          action: 'INCENTIVE_CREATED',
          entity: 'Incentive',
          entityId: incentive.id,
          changes: {
            employeeId: dto.employeeId,
            amount: dto.amount,
            reason: dto.reason.trim(),
            month: dto.month,
            year: dto.year,
          },
        },
      });

      return incentive;
    });
  }

  async findAll(
    query: IncentiveQueryDto,
    actingUser?: { id: string; role: UserRole },
  ) {
    const where: Prisma.IncentiveWhereInput = {};

    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }

    if (query.month) {
      where.month = query.month;
    }

    if (query.year) {
      where.year = query.year;
    }

    let employeeWhere: Prisma.EmployeeWhereInput = {};
    if (query.branchId) {
      employeeWhere.currentBranchId = query.branchId;
    }
    if (actingUser?.id) {
      employeeWhere =
        await this.accessScopeService.narrowEmployeeWhereForActor(
          actingUser.id,
          actingUser.role,
          employeeWhere,
        );
    }
    if (Object.keys(employeeWhere).length > 0) {
      where.employee = employeeWhere;
    }

    return this.prisma.incentive.findMany({
      where,
      include: {
        employee: {
          select: {
            fullName: true,
            employeeCode: true,
            currentBranch: { select: { name: true, address: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByEmployee(employeeId: string) {
    return this.prisma.incentive.findMany({
      where: { employeeId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async delete(id: string, actingUserId: string) {
    const incentive = await this.prisma.incentive.findUnique({
      where: { id },
    });

    if (!incentive) {
      throw new NotFoundException(`Incentive with id ${id} not found`);
    }

    const payrollEntry = await this.prisma.payrollEntry.findFirst({
      where: {
        month: incentive.month,
        year: incentive.year,
        stipendRecord: { employeeId: incentive.employeeId },
      },
      include: { allowances: true },
    });

    if (!payrollEntry) {
      throw new NotFoundException('Associated payroll entry not found');
    }

    const allowance = payrollEntry.allowances.find((item) =>
      isIncentiveAllowance(item.description, incentive.reason),
    );

    if (!allowance) {
      throw new NotFoundException('Associated allowance record not found');
    }

    const amount = Number(incentive.amount);

    await this.prisma.$transaction(async (tx) => {
      await tx.allowance.delete({ where: { id: allowance.id } });

      await tx.payrollEntry.update({
        where: { id: payrollEntry.id },
        data: {
          totalAllowances: { decrement: amount },
          netStipend: { decrement: amount },
        },
      });

      await tx.incentive.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'INCENTIVE_DELETED',
          entity: 'Incentive',
          entityId: id,
          changes: {
            employeeId: incentive.employeeId,
            amount,
            reason: incentive.reason,
          },
        },
      });
    });

    return { message: 'Incentive deleted' };
  }

  private async getOrCreatePayrollEntry(
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
      throw new NotFoundException(
        `No active stipend record found for employee ${employeeId}`,
      );
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
        totalAllowances: 0,
        status: PayrollStatus.PENDING,
      },
    });
  }
}
