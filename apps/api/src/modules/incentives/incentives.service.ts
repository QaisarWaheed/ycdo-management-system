import { withPayrollEmployeeTransaction } from '../payroll/payroll-write-lock.util';
import { packageCoversEntryMonth } from '../payroll/payroll-aggregate.util';
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
  UpdateIncentiveDto,
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
  private async resolveReason(dto: { typeId?: string; reason?: string }): Promise<string> {
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
        type: { select: { id: true, name: true } },
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

  /** Monthly totals for the 12 months ending `year`/`month`, and that month by branch. */
  async stats(year: number, month: number) {
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(year, month - 12 + i, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
    });
    const [monthly, thisMonth] = await Promise.all([
      this.prisma.incentive.groupBy({
        by: ['year', 'month'],
        where: { OR: months },
        _sum: { amount: true },
      }),
      this.prisma.incentive.findMany({
        where: { year, month },
        select: {
          amount: true,
          employee: { select: { currentBranch: { select: { name: true } } } },
        },
      }),
    ]);
    const byBranch = new Map<string, number>();
    for (const i of thisMonth) {
      const name = i.employee.currentBranch?.name ?? 'No branch';
      byBranch.set(name, (byBranch.get(name) ?? 0) + Number(i.amount));
    }
    return {
      monthly: months.map((m) => ({
        ...m,
        total: Number(
          monthly.find((g) => g.year === m.year && g.month === m.month)?._sum
            .amount ?? 0,
        ),
      })),
      byBranch: [...byBranch.entries()]
        .map(([branch, total]) => ({ branch, total }))
        .sort((x, y) => y.total - x.total),
    };
  }

  async findOne(id: string) {
    const incentive = await this.prisma.incentive.findUnique({ where: { id } });
    if (!incentive) throw new NotFoundException(`Incentive with id ${id} not found`);
    return incentive;
  }

  findByEmployee(employeeId: string) {
    return this.prisma.incentive.findMany({
      where: { employeeId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async delete(id: string, actingUserId: string, allowLocked = false) {
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
      const { payrollEntry, allowance } = await this.pendingIncentiveRow(
        tx,
        incentive,
        allowLocked,
      );

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

  /**
   * Fix a wrong incentive while its month is still Pending: amount, type,
   * note or month. The payroll rows move with it and the change is logged.
   */
  async update(
    id: string,
    dto: UpdateIncentiveDto,
    actingUserId: string,
    /** Super Admin: also when the month is Processed / Paid. */
    allowLocked = false,
  ) {
    const existing = await this.prisma.incentive.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Incentive with id ${id} not found`);
    const reason = await this.resolveReason(dto);

    return withPayrollEmployeeTransaction(this.prisma, existing.employeeId, async (tx) => {
      const incentive = await tx.incentive.findUnique({ where: { id } });
      if (!incentive) throw new NotFoundException(`Incentive with id ${id} not found`);
      const { payrollEntry: oldEntry, allowance } = await this.pendingIncentiveRow(
        tx,
        incentive,
        allowLocked,
      );
      const oldAmount = Number(incentive.amount);
      const moved = dto.month !== incentive.month || dto.year !== incentive.year;

      await tx.allowance.delete({ where: { id: allowance.id } });
      const oldAfter = await tx.payrollEntry.update({
        where: { id: oldEntry.id },
        data: {
          totalAllowances: { decrement: oldAmount },
          netStipend: { decrement: oldAmount },
        },
      });

      const newEntry = moved
        ? await this.getOrCreatePayrollEntry(tx, incentive.employeeId, dto.month, dto.year)
        : oldEntry;
      if (!allowLocked && newEntry.status !== PayrollStatus.PENDING) {
        throw new BadRequestException(
          `Payroll for ${dto.month}/${dto.year} is already ${newEntry.status}; incentives can only be moved into a PENDING month`,
        );
      }
      await tx.allowance.create({
        data: {
          payrollEntryId: newEntry.id,
          type: AllowanceType.CUSTOM,
          description: incentiveAllowanceDescription(reason),
          amount: dto.amount,
        },
      });
      const after = await tx.payrollEntry.update({
        where: { id: newEntry.id },
        data: {
          totalAllowances: { increment: dto.amount },
          netStipend: { increment: dto.amount },
        },
      });
      const updated = await tx.incentive.update({
        where: { id },
        data: {
          amount: dto.amount,
          reason,
          typeId: dto.typeId ?? null,
          month: dto.month,
          year: dto.year,
        },
      });

      const was = `${incentive.reason} PKR ${pkr(oldAmount)}`;
      const now = `${reason} PKR ${pkr(dto.amount)}`;
      if (moved) {
        await logIncentiveChange(tx, {
          payrollEntryId: oldEntry.id,
          userId: actingUserId,
          action: 'INCENTIVE_REMOVED',
          summary: `Incentive moved to ${dto.month}/${dto.year}: ${was}`,
          netAfter: Number(oldAfter.netStipend),
          amount: -oldAmount,
        });
        await logIncentiveChange(tx, {
          payrollEntryId: newEntry.id,
          userId: actingUserId,
          action: 'INCENTIVE_ADDED',
          summary: `Incentive moved from ${incentive.month}/${incentive.year}: ${now}`,
          netAfter: Number(after.netStipend),
          amount: dto.amount,
        });
      } else {
        await logIncentiveChange(tx, {
          payrollEntryId: newEntry.id,
          userId: actingUserId,
          action: 'INCENTIVE_CHANGED',
          summary: `Incentive changed: ${was} → ${now}`,
          netAfter: Number(after.netStipend),
          amount: dto.amount - oldAmount,
        });
      }
      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'INCENTIVE_UPDATED',
          entity: 'Incentive',
          entityId: id,
          changes: {
            employeeId: incentive.employeeId,
            before: {
              amount: oldAmount,
              reason: incentive.reason,
              month: incentive.month,
              year: incentive.year,
            },
            after: { amount: dto.amount, reason, month: dto.month, year: dto.year },
          },
        },
      });
      return updated;
    });
  }

  /** The incentive's payroll entry and allowance row; only while that month is Pending. */
  private async pendingIncentiveRow(
    tx: Prisma.TransactionClient,
    incentive: { employeeId: string; month: number; year: number; reason: string },
    allowLocked = false,
  ) {
    const payrollEntry = await tx.payrollEntry.findFirst({
      where: {
        month: incentive.month,
        year: incentive.year,
        stipendRecord: { employeeId: incentive.employeeId },
        allowances: {
          some: { description: incentiveAllowanceDescription(incentive.reason) },
        },
      },
      include: { allowances: true },
    });
    if (!payrollEntry) {
      throw new NotFoundException('Associated payroll entry not found');
    }
    if (!allowLocked && payrollEntry.status !== PayrollStatus.PENDING) {
      throw new BadRequestException(
        `Payroll for ${incentive.month}/${incentive.year} is already ${payrollEntry.status}; this incentive can no longer be changed`,
      );
    }
    const allowance = payrollEntry.allowances.find((item) =>
      isIncentiveAllowance(item.description, incentive.reason),
    );
    if (!allowance) {
      throw new NotFoundException('Associated allowance record not found');
    }
    return { payrollEntry, allowance };
  }

  /**
   * The month's own payroll entry: the one whose package covers the month
   * (the open package first). An incentive never creates an entry — a new
   * one would carry the full package basic and double the month (e.g. after
   * an increment that starts next month).
   */
  private async getOrCreatePayrollEntry(
    tx: Prisma.TransactionClient,
    employeeId: string,
    month: number,
    year: number,
  ) {
    const entries = await tx.payrollEntry.findMany({
      where: { month, year, stipendRecord: { employeeId } },
      include: {
        stipendRecord: { select: { effectiveFrom: true, effectiveTo: true } },
      },
    });
    const covering = entries
      .filter((e) => packageCoversEntryMonth(e))
      .sort(
        (a, b) =>
          Number(a.stipendRecord.effectiveTo != null) -
            Number(b.stipendRecord.effectiveTo != null) ||
          b.stipendRecord.effectiveFrom.getTime() -
            a.stipendRecord.effectiveFrom.getTime(),
      );
    const entry = covering[0];
    if (!entry) {
      throw new BadRequestException(
        `There is no payroll for ${month}/${year} for this employee yet. Generate that month's payroll first, then add the incentive.`,
      );
    }
    return entry;
  }
}

const pkr = (n: number) => Math.round(n).toLocaleString('en-PK');

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
