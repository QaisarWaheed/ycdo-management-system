import { withPayrollEmployeeTransaction } from '../payroll/payroll-write-lock.util';
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
    const reason = await this.resolveReason(dto);

    await this.accessScopeService.assertEmployeeAccess(
      addedById,
      actingRole,
      Permission.INCENTIVES_MANAGE,
      dto.employeeId,
    );

    return withPayrollEmployeeTransaction(this.prisma, dto.employeeId, async (tx) => {
      const employee = await tx.employee.findUnique({
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

      const incentive = await tx.incentive.create({
        data: {
          employeeId: dto.employeeId,
          amount: dto.amount,
          reason: reason,
          typeId: dto.typeId ?? null,
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
      if (payrollEntry.status !== PayrollStatus.PENDING) {
        throw new BadRequestException(
          `Payroll for ${dto.month}/${dto.year} is already ${payrollEntry.status}; incentives can only be added while it is PENDING`,
        );
      }

      await tx.allowance.create({
        data: {
          payrollEntryId: payrollEntry.id,
          type: AllowanceType.CUSTOM,
          description: incentiveAllowanceDescription(reason),
          amount: dto.amount,
        },
      });

      const after = await tx.payrollEntry.update({
        where: { id: payrollEntry.id },
        data: {
          totalAllowances: { increment: dto.amount },
          netStipend: { increment: dto.amount },
        },
      });
      await logIncentiveChange(tx, {
        payrollEntryId: payrollEntry.id,
        userId: addedById,
        action: 'INCENTIVE_ADDED',
        summary: `Incentive added: ${reason} PKR ${Math.round(dto.amount).toLocaleString('en-PK')}`,
        netAfter: Number(after.netStipend),
        amount: dto.amount,
      });

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'INCENTIVE_ADDED',
          message: `You have received an incentive of PKR ${dto.amount} for ${dto.month}/${dto.year}. Reason: ${reason}`,
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
            reason: reason,
            month: dto.month,
            year: dto.year,
          },
        },
      });

      return incentive;
    });
  }

  /** "Type: note", the type alone, or the note alone (old free-text incentives). */
  private async resolveReason(dto: CreateIncentiveDto): Promise<string> {
    const note = dto.reason?.trim() ?? '';
    if (!dto.typeId) {
      if (!note) throw new BadRequestException('Choose an incentive type or write a reason');
      return note;
    }
    const type = await this.prisma.incentiveType.findUnique({ where: { id: dto.typeId } });
    if (!type) throw new BadRequestException('Incentive type not found');
    return note ? `${type.name}: ${note}` : type.name;
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
            status: true,
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

    await withPayrollEmployeeTransaction(this.prisma, incentive.employeeId, async (tx) => {
      const incentive = await tx.incentive.findUnique({ where: { id } });
      if (!incentive) {
        throw new NotFoundException(`Incentive with id ${id} not found`);
      }
      const payrollEntry = await tx.payrollEntry.findFirst({
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

      await tx.allowance.delete({ where: { id: allowance.id } });

      const after = await tx.payrollEntry.update({
        where: { id: payrollEntry.id },
        data: {
          totalAllowances: { decrement: amount },
          netStipend: { decrement: amount },
        },
      });
      await logIncentiveChange(tx, {
        payrollEntryId: payrollEntry.id,
        userId: actingUserId,
        action: 'INCENTIVE_REMOVED',
        summary: `Incentive removed: ${incentive.reason} PKR ${Math.round(amount).toLocaleString('en-PK')}`,
        netAfter: Number(after.netStipend),
        amount: -amount,
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

/** Payroll entry history line for an incentive (net before = after − amount). */
async function logIncentiveChange(
  tx: Prisma.TransactionClient,
  e: { payrollEntryId: string; userId: string; action: string; summary: string; netAfter: number; amount: number },
) {
  // Unit-test doubles of Prisma often omit this model; real clients always have it.
  if (!(tx as { payrollChangeLog?: unknown }).payrollChangeLog) return;
  await tx.payrollChangeLog.create({
    data: {
      payrollEntryId: e.payrollEntryId,
      userId: e.userId,
      action: e.action,
      summary: e.summary,
      netBefore: e.netAfter - e.amount,
      netAfter: e.netAfter,
    },
  });
}
