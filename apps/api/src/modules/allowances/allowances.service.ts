import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayrollStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { monthLabel, pkr } from '../pay-approvals/pay-change-requests.service';
import type {
  AssignAllowanceDto,
  CreateAllowanceTypeDto,
  CreateIncentiveTypeDto,
  UpdateAllowanceTypeDto,
  UpdateIncentiveTypeDto,
} from './allowances.dto';
import {
  isActiveInMonth,
  monthKey,
  monthStartUtc,
  PACKAGE_ALLOWANCES_FROM,
  usesAllowanceTable,
} from './package-allowances.util';

type Actor = { id: string };

const parseMonth = (value: string) => {
  const [y, m] = value.split('-').map(Number);
  return { year: y, month: m, date: monthStartUtc(y, m), key: y * 12 + m };
};
const fromKey = (key: number) => {
  const year = Math.floor((key - 1) / 12);
  const month = key - year * 12;
  return monthStartUtc(year, month);
};
const label = (d: Date) => monthLabel(d.getUTCFullYear(), d.getUTCMonth() + 1);

@Injectable()
export class AllowancesService {
  constructor(
    private prisma: PrismaService,
    private payrollService: PayrollService,
  ) {}

  // ── Allowance types ────────────────────────────────────────────────────
  listTypes() {
    return this.prisma.payAllowanceType.findMany({
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { assignments: true } } },
    });
  }

  async createType(dto: CreateAllowanceTypeDto, user: Actor) {
    const type = await this.uniqueName(() =>
      this.prisma.payAllowanceType.create({
        data: { name: dto.name.trim(), proration: dto.proration },
      }),
    );
    await this.audit(
      user,
      'ALLOWANCE_TYPE_CREATED',
      'PayAllowanceType',
      type.id,
      { ...dto },
    );
    return type;
  }

  async updateType(id: string, dto: UpdateAllowanceTypeDto, user: Actor) {
    const before = await this.prisma.payAllowanceType.findUnique({
      where: { id },
    });
    if (!before) throw new NotFoundException('Allowance type not found');
    const type = await this.uniqueName(() =>
      this.prisma.payAllowanceType.update({
        where: { id },
        data: { ...dto, name: dto.name?.trim() },
      }),
    );
    await this.audit(user, 'ALLOWANCE_TYPE_UPDATED', 'PayAllowanceType', id, {
      before: {
        name: before.name,
        proration: before.proration,
        isActive: before.isActive,
      },
      after: { ...dto },
    });
    return type;
  }

  // ── Incentive types ────────────────────────────────────────────────────
  listIncentiveTypes() {
    return this.prisma.incentiveType.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async createIncentiveType(dto: CreateIncentiveTypeDto, user: Actor) {
    const type = await this.uniqueName(() =>
      this.prisma.incentiveType.create({ data: { name: dto.name.trim() } }),
    );
    await this.audit(user, 'INCENTIVE_TYPE_CREATED', 'IncentiveType', type.id, {
      ...dto,
    });
    return type;
  }

  async updateIncentiveType(
    id: string,
    dto: UpdateIncentiveTypeDto,
    user: Actor,
  ) {
    const type = await this.uniqueName(() =>
      this.prisma.incentiveType.update({
        where: { id },
        data: { ...dto, name: dto.name?.trim() },
      }),
    );
    await this.audit(user, 'INCENTIVE_TYPE_UPDATED', 'IncentiveType', id, {
      ...dto,
    });
    return type;
  }

  // ── Employee allowances ────────────────────────────────────────────────
  listForEmployee(employeeId: string) {
    return this.prisma.employeeAllowance.findMany({
      where: { employeeId },
      include: { type: true },
      orderBy: [{ startMonth: 'desc' }],
    });
  }

  /** Before/after amounts for an assignment, so the caller can decide on approval. */
  async describeAssign(dto: AssignAllowanceDto) {
    const start = parseMonth(dto.startMonth);
    const type = await this.prisma.payAllowanceType.findUnique({
      where: { id: dto.typeId },
    });
    if (!type) throw new NotFoundException('Allowance type not found');
    const rows = await this.prisma.employeeAllowance.findMany({
      where: { employeeId: dto.employeeId, typeId: dto.typeId },
    });
    const current = rows.find((r) =>
      isActiveInMonth(r, start.year, start.month),
    );
    const before = current ? Number(current.amount) : 0;
    const until = dto.endMonth
      ? ` to ${label(parseMonth(dto.endMonth).date)}`
      : '';
    return {
      isIncrease: dto.amount > before,
      summary: `${type.name} ${pkr(before)} → ${pkr(dto.amount)} from ${label(start.date)}${until}`,
    };
  }

  async assign(dto: AssignAllowanceDto, user: Actor) {
    const start = parseMonth(dto.startMonth);
    const end = dto.endMonth ? parseMonth(dto.endMonth) : null;
    if (!usesAllowanceTable(start.year, start.month)) {
      throw new BadRequestException(
        `Allowances start from ${monthLabel(PACKAGE_ALLOWANCES_FROM.year, PACKAGE_ALLOWANCES_FROM.month)}; earlier months use the old package`,
      );
    }
    if (end && end.key < start.key) {
      throw new BadRequestException(
        'The last month cannot be before the first month',
      );
    }
    const [type, employee] = await Promise.all([
      this.prisma.payAllowanceType.findUnique({ where: { id: dto.typeId } }),
      this.prisma.employee.findUnique({
        where: { id: dto.employeeId },
        select: { id: true },
      }),
    ]);
    if (!employee) throw new NotFoundException('Employee not found');
    if (!type || !type.isActive) {
      throw new BadRequestException('This allowance type is not available');
    }

    const rows = await this.prisma.employeeAllowance.findMany({
      where: { employeeId: dto.employeeId, typeId: dto.typeId },
    });
    const current = rows.find((r) =>
      isActiveInMonth(r, start.year, start.month),
    );
    const endKey = end?.key ?? Number.POSITIVE_INFINITY;
    const clash = rows.find(
      (r) =>
        r !== current &&
        monthKey(r.startMonth) <= endKey &&
        (r.endMonth == null || monthKey(r.endMonth) >= start.key),
    );
    if (clash) {
      throw new ConflictException(
        `${type.name} is already set from ${label(clash.startMonth)}; end or change that one first`,
      );
    }

    const data = {
      amount: dto.amount,
      endMonth: end?.date ?? null,
      note: dto.note?.trim() || null,
    };
    const saved = await this.prisma.$transaction(async (tx) => {
      if (current && monthKey(current.startMonth) === start.key) {
        return tx.employeeAllowance.update({ where: { id: current.id }, data });
      }
      if (current) {
        await tx.employeeAllowance.update({
          where: { id: current.id },
          data: { endMonth: fromKey(start.key - 1) },
        });
      }
      return tx.employeeAllowance.create({
        data: {
          ...data,
          employeeId: dto.employeeId,
          typeId: dto.typeId,
          startMonth: start.date,
          createdById: user.id,
        },
      });
    });

    await this.audit(
      user,
      'EMPLOYEE_ALLOWANCE_SET',
      'EmployeeAllowance',
      saved.id,
      {
        employeeId: dto.employeeId,
        type: type.name,
        before: current ? Number(current.amount) : 0,
        after: dto.amount,
        startMonth: dto.startMonth,
        endMonth: dto.endMonth ?? null,
      },
    );
    await this.recomputePendingFrom(dto.employeeId, start.key);
    return saved;
  }

  /** Stop an allowance after `endMonth` (a decrease, so no approval needed). */
  async end(id: string, endMonth: string, user: Actor) {
    const row = await this.prisma.employeeAllowance.findUnique({
      where: { id },
      include: { type: true },
    });
    if (!row) throw new NotFoundException('Allowance not found');
    const end = parseMonth(endMonth);
    if (row.endMonth && monthKey(row.endMonth) <= end.key) {
      throw new BadRequestException('It already ends by that month');
    }
    const startKey = monthKey(row.startMonth);
    if (end.key < startKey) {
      // Never applied: remove it rather than store an empty range.
      await this.prisma.employeeAllowance.delete({ where: { id } });
    } else {
      await this.prisma.employeeAllowance.update({
        where: { id },
        data: { endMonth: end.date },
      });
    }
    await this.audit(
      user,
      'EMPLOYEE_ALLOWANCE_ENDED',
      'EmployeeAllowance',
      id,
      {
        employeeId: row.employeeId,
        type: row.type.name,
        amount: Number(row.amount),
        endMonth,
      },
    );
    await this.recomputePendingFrom(
      row.employeeId,
      Math.max(startKey, end.key + 1),
    );
    return { id, endMonth };
  }

  /**
   * Switch-over check: each employee's current package (old four fields)
   * against the allowances copied for the cut-over month.
   */
  async migrationCheck() {
    const { year, month } = PACKAGE_ALLOWANCES_FROM;
    const records = await this.prisma.stipendRecord.findMany({
      where: { effectiveTo: null },
      select: {
        employeeId: true,
        allowances: true,
        reward: true,
        progressReward: true,
        fuelAllowance: true,
        employee: { select: { fullName: true, employeeCode: true } },
      },
    });
    const rows = await this.prisma.employeeAllowance.findMany({
      where: { type: { legacyField: { not: null } } },
      include: { type: true },
    });
    const byEmployee = new Map<string, number>();
    for (const r of rows) {
      if (!isActiveInMonth(r, year, month)) continue;
      byEmployee.set(
        r.employeeId,
        (byEmployee.get(r.employeeId) ?? 0) + Number(r.amount),
      );
    }
    const mismatches = records
      .map((rec) => {
        const legacy =
          Number(rec.allowances ?? 0) +
          Number(rec.reward ?? 0) +
          Number(rec.progressReward ?? 0) +
          Number(rec.fuelAllowance ?? 0);
        const table = byEmployee.get(rec.employeeId) ?? 0;
        return { ...rec.employee, employeeId: rec.employeeId, legacy, table };
      })
      .filter((m) => Math.abs(m.legacy - m.table) > 0.004);
    return { checked: records.length, mismatches };
  }

  // ── helpers ────────────────────────────────────────────────────────────
  private async recomputePendingFrom(employeeId: string, fromMonthKey: number) {
    const entries = await this.prisma.payrollEntry.findMany({
      where: { status: PayrollStatus.PENDING, stipendRecord: { employeeId } },
      select: { month: true, year: true },
    });
    const months = new Set(
      entries
        .filter((e) => e.year * 12 + e.month >= fromMonthKey)
        .map((e) => `${e.year}-${e.month}`),
    );
    for (const m of months) {
      const [year, month] = m.split('-').map(Number);
      await this.payrollService.recomputeEmployeeMonth({
        employeeId,
        month,
        year,
      });
    }
  }

  private async uniqueName<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('A type with this name already exists');
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException('Type not found');
      }
      throw err;
    }
  }

  private async audit(
    user: Actor,
    action: string,
    entity: string,
    entityId: string,
    changes: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action,
        entity,
        entityId,
        changes: changes as Prisma.InputJsonValue,
      },
    });
  }
}
