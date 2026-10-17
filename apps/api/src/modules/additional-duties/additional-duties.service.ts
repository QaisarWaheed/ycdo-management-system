import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isActiveInMonth } from '../allowances/package-allowances.util';
import type {
  CreateAdditionalDutyDto,
  UpdateAdditionalDutyDto,
} from './additional-duties.dto';

type Actor = { id: string };
type DutyDates = { startDate: Date; endDate: Date | null };
type AllowanceMonths = { startMonth: Date; endMonth: Date | null };

/** First and last day of a month, UTC (matches the @db.Date columns). */
export function monthBounds(year: number, month: number) {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0)),
  };
}

export function dutyActiveInMonth(
  duty: DutyDates,
  year: number,
  month: number,
): boolean {
  const { start, end } = monthBounds(year, month);
  return (
    duty.startDate <= end && (duty.endDate == null || duty.endDate >= start)
  );
}

/**
 * A duty active in the month needs a reminder unless its linked allowance
 * pays that month. `allowance` is the linked row (undefined = none / deleted).
 */
export function dutyNeedsAllowance(
  duty: DutyDates & { allowanceId: string | null },
  allowance: AllowanceMonths | undefined,
  year: number,
  month: number,
): boolean {
  if (!dutyActiveInMonth(duty, year, month)) return false;
  return (
    !duty.allowanceId || !allowance || !isActiveInMonth(allowance, year, month)
  );
}

const toDate = (value: string) => {
  const d = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
  return d;
};

/** Duty title: trimmed, 1–100 characters. */
export function cleanTitle(title: string): string {
  const t = title.trim();
  if (!t) throw new BadRequestException('Write the duty title');
  if (t.length > 100) {
    throw new BadRequestException('Duty title is too long (max 100)');
  }
  return t;
}

export function assertDateOrder(start: Date, end: Date | null) {
  if (end && end < start) {
    throw new BadRequestException('End date cannot be before the start date');
  }
}

/**
 * Extra duties held alongside the employee's own post (e.g. Ward In-charge).
 * A duty never changes designation, department or salary by itself; pay for
 * it is a normal EmployeeAllowance linked through `allowanceId`.
 */
@Injectable()
export class AdditionalDutiesService {
  constructor(private prisma: PrismaService) {}

  list(employeeId?: string) {
    return this.prisma.employeeAdditionalDuty.findMany({
      where: employeeId ? { employeeId } : undefined,
      orderBy: [{ startDate: 'desc' }],
    });
  }

  async create(dto: CreateAdditionalDutyDto, user: Actor) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const startDate = toDate(dto.startDate);
    const endDate = dto.endDate ? toDate(dto.endDate) : null;
    assertDateOrder(startDate, endDate);
    const duty = await this.prisma.employeeAdditionalDuty.create({
      data: {
        employeeId: dto.employeeId,
        title: cleanTitle(dto.title),
        startDate,
        endDate,
        note: dto.note?.trim() || null,
        createdById: user.id,
      },
    });
    await this.audit(user, 'ADDITIONAL_DUTY_CREATED', duty.id, {
      employeeId: duty.employeeId,
      title: duty.title,
      startDate: dto.startDate,
      endDate: dto.endDate ?? null,
    });
    return duty;
  }

  async update(id: string, dto: UpdateAdditionalDutyDto, user: Actor) {
    const before = await this.find(id);
    const startDate =
      dto.startDate !== undefined ? toDate(dto.startDate) : before.startDate;
    const endDate =
      dto.endDate === undefined
        ? before.endDate
        : dto.endDate
          ? toDate(dto.endDate)
          : null;
    assertDateOrder(startDate, endDate);
    const duty = await this.prisma.employeeAdditionalDuty.update({
      where: { id },
      data: {
        title: dto.title !== undefined ? cleanTitle(dto.title) : undefined,
        startDate,
        endDate,
        note: dto.note === undefined ? undefined : dto.note?.trim() || null,
      },
    });
    await this.audit(user, 'ADDITIONAL_DUTY_UPDATED', id, {
      employeeId: before.employeeId,
      before: {
        title: before.title,
        startDate: before.startDate,
        endDate: before.endDate,
        note: before.note,
      },
      after: { ...dto },
    });
    return duty;
  }

  /** Link the allowance paid for the duty; it must be the same employee's. */
  async linkAllowance(id: string, allowanceId: string | null, user: Actor) {
    const before = await this.find(id);
    if (allowanceId) {
      const allowance = await this.prisma.employeeAllowance.findUnique({
        where: { id: allowanceId },
        select: { employeeId: true },
      });
      if (!allowance || allowance.employeeId !== before.employeeId) {
        throw new BadRequestException(
          "That allowance is not on this employee's package",
        );
      }
    }
    const duty = await this.prisma.employeeAdditionalDuty.update({
      where: { id },
      data: { allowanceId },
    });
    await this.audit(user, 'ADDITIONAL_DUTY_ALLOWANCE_LINKED', id, {
      employeeId: before.employeeId,
      before: before.allowanceId,
      after: allowanceId,
    });
    return duty;
  }

  async remove(id: string, user: Actor) {
    const before = await this.find(id);
    await this.prisma.employeeAdditionalDuty.delete({ where: { id } });
    await this.audit(user, 'ADDITIONAL_DUTY_DELETED', id, {
      employeeId: before.employeeId,
      title: before.title,
      startDate: before.startDate,
      endDate: before.endDate,
      allowanceId: before.allowanceId,
    });
    return { id };
  }

  /** Duties held in the month with no allowance paying that month. */
  async missingAllowance(year: number, month: number) {
    const { start, end } = monthBounds(year, month);
    const duties = await this.prisma.employeeAdditionalDuty.findMany({
      where: {
        startDate: { lte: end },
        OR: [{ endDate: null }, { endDate: { gte: start } }],
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            currentDesignation: true,
            currentBranch: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ employee: { fullName: 'asc' } }, { startDate: 'asc' }],
    });
    const ids = duties.flatMap((d) => (d.allowanceId ? [d.allowanceId] : []));
    const allowances = ids.length
      ? await this.prisma.employeeAllowance.findMany({
          where: { id: { in: ids } },
          select: { id: true, startMonth: true, endMonth: true },
        })
      : [];
    const byId = new Map(allowances.map((a) => [a.id, a]));
    return duties
      .filter((d) =>
        dutyNeedsAllowance(
          d,
          d.allowanceId ? byId.get(d.allowanceId) : undefined,
          year,
          month,
        ),
      )
      .map((d) => ({
        id: d.id,
        title: d.title,
        startDate: d.startDate,
        endDate: d.endDate,
        allowanceId: d.allowanceId,
        employee: d.employee,
      }));
  }

  private async find(id: string) {
    const duty = await this.prisma.employeeAdditionalDuty.findUnique({
      where: { id },
    });
    if (!duty) throw new NotFoundException('Additional duty not found');
    return duty;
  }

  private async audit(
    user: Actor,
    action: string,
    entityId: string,
    changes: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action,
        entity: 'EmployeeAdditionalDuty',
        entityId,
        changes: changes as Prisma.InputJsonValue,
      },
    });
  }
}
