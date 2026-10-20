import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayrollStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { MEDICINE_PENDING_PREFIX } from './medicine-pending.util';

@Injectable()
export class MedicinePendingService {
  constructor(
    private prisma: PrismaService,
    private payroll: PayrollService,
  ) {}

  async list(q: { from?: string; to?: string; employeeId?: string }) {
    const rows = await this.prisma.medicinePendingEntry.findMany({
      where: {
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.from || q.to
          ? {
              pendingDate: {
                ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}),
                ...(q.to ? { lte: new Date(`${q.to}T00:00:00.000Z`) } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ pendingDate: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
      include: {
        employee: {
          select: {
            fullName: true,
            employeeCode: true,
            currentBranch: { select: { name: true } },
          },
        },
      },
    });
    return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  }

  async create(
    dto: {
      employeeId: string;
      tokenNo: string;
      amount: number;
      pendingDate: string;
      note?: string;
    },
    userId: string,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const pendingDate = new Date(`${dto.pendingDate.slice(0, 10)}T00:00:00.000Z`);
    await this.assertMonthOpen(dto.employeeId, pendingDate);
    const entry = await this.prisma.medicinePendingEntry.create({
      data: {
        employeeId: dto.employeeId,
        tokenNo: dto.tokenNo.trim(),
        amount: dto.amount,
        pendingDate,
        note: dto.note?.trim() || null,
        createdById: userId,
      },
    });
    await this.audit(userId, 'MEDICINE_PENDING_ADDED', entry.id, {
      employeeId: dto.employeeId,
      tokenNo: entry.tokenNo,
      amount: dto.amount,
      pendingDate: dto.pendingDate.slice(0, 10),
    });
    await this.refreshPayroll(dto.employeeId, pendingDate);
    return { ...entry, amount: Number(entry.amount) };
  }

  async remove(id: string, userId: string) {
    const entry = await this.prisma.medicinePendingEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Entry not found');
    await this.assertMonthOpen(entry.employeeId, entry.pendingDate);
    await this.prisma.payrollDeduction.deleteMany({
      where: {
        description: { startsWith: `${MEDICINE_PENDING_PREFIX}${id}]` },
        payrollEntry: { status: PayrollStatus.PENDING },
      },
    });
    await this.prisma.medicinePendingEntry.delete({ where: { id } });
    await this.audit(userId, 'MEDICINE_PENDING_REMOVED', id, {
      employeeId: entry.employeeId,
      tokenNo: entry.tokenNo,
      amount: Number(entry.amount),
    });
    await this.refreshPayroll(entry.employeeId, entry.pendingDate);
    return { id, removed: true };
  }

  /** A month already verified / processed / paid cannot take new entries. */
  private async assertMonthOpen(employeeId: string, day: Date) {
    const frozen = await this.prisma.payrollEntry.findFirst({
      where: {
        month: day.getUTCMonth() + 1,
        year: day.getUTCFullYear(),
        stipendRecord: { employeeId },
        status: { not: PayrollStatus.PENDING },
      },
      select: { id: true },
    });
    if (frozen) {
      throw new BadRequestException(
        'This month’s salary is already verified or paid; add the entry in an open month',
      );
    }
  }

  /** Recompute the open payroll month so the deduction shows at once. */
  private async refreshPayroll(employeeId: string, day: Date) {
    await this.payroll.recomputeEmployeeMonth({
      employeeId,
      month: day.getUTCMonth() + 1,
      year: day.getUTCFullYear(),
    });
  }

  private audit(userId: string, action: string, entityId: string, changes: Record<string, unknown>) {
    return this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entity: 'MedicinePendingEntry',
        entityId,
        changes: changes as Prisma.InputJsonValue,
      },
    });
  }
}
