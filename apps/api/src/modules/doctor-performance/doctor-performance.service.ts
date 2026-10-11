import { BadRequestException, Injectable } from '@nestjs/common';
import {
  EmployeeStatus,
  PayChangeKind,
  PayChangeStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FIGURE_KEYS,
  isDoctorDesignation,
  previousMonth,
  type PerformanceFigures,
} from './doctor-performance.util';

type Actor = { id: string };
export type PerformanceRowInput = PerformanceFigures & {
  employeeId: string;
  note?: string | null;
};

const figures = (r: {
  opdPatients: number;
  indoorPatients: number;
  surgeries: number;
  labTests: number;
  collection: Prisma.Decimal | number;
  note: string | null;
}) => ({
  opdPatients: r.opdPatients,
  indoorPatients: r.indoorPatients,
  surgeries: r.surgeries,
  labTests: r.labTests,
  collection: Number(r.collection),
  note: r.note,
});

/**
 * Doctors' monthly figures: Finance enters them, executives compare with the
 * previous month and set incentives on the same sheet.
 */
@Injectable()
export class DoctorPerformanceService {
  constructor(private prisma: PrismaService) {}

  /** Designation titles that count as doctors. */
  private async doctorTitles() {
    const designations = await this.prisma.designation.findMany({
      where: { isDeleted: false },
      select: { title: true, category: true },
    });
    return designations
      .filter((d) => isDoctorDesignation(d.title, d.category))
      .map((d) => d.title);
  }

  async list(year: number, month: number, branchId?: string) {
    const prev = previousMonth(year, month);
    const titles = await this.doctorTitles();
    const months = [
      { year, month },
      { year: prev.year, month: prev.month },
    ];
    // Active doctors, plus anyone who already has figures for these months.
    const employees = await this.prisma.employee.findMany({
      where: {
        currentDesignation: { in: titles },
        ...(branchId ? { currentBranchId: branchId } : {}),
        OR: [
          { status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] } },
          { doctorPerformance: { some: { OR: months } } },
        ],
      },
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        currentDesignation: true,
        status: true,
        currentBranch: { select: { id: true, name: true } },
      },
      orderBy: [{ currentBranch: { name: 'asc' } }, { fullName: 'asc' }],
    });
    const ids = employees.map((e) => e.id);
    if (!ids.length) return { year, month, previous: prev, rows: [] };

    const [records, incentives, pending] = await Promise.all([
      this.prisma.doctorMonthlyPerformance.findMany({
        where: { employeeId: { in: ids }, OR: months },
      }),
      this.prisma.incentive.findMany({
        where: { employeeId: { in: ids }, year, month },
        select: {
          employeeId: true,
          amount: true,
          reason: true,
          type: { select: { name: true } },
        },
      }),
      this.prisma.payChangeRequest.findMany({
        where: {
          employeeId: { in: ids },
          kind: PayChangeKind.INCENTIVE,
          status: PayChangeStatus.PENDING,
        },
        select: { employeeId: true, payload: true, summary: true },
      }),
    ]);

    const find = (employeeId: string, y: number, m: number) =>
      records.find(
        (r) => r.employeeId === employeeId && r.year === y && r.month === m,
      );
    const rows = employees.map((e) => {
      const current = find(e.id, year, month);
      const previous = find(e.id, prev.year, prev.month);
      return {
        employee: {
          id: e.id,
          fullName: e.fullName,
          employeeCode: e.employeeCode,
          designation: e.currentDesignation,
          status: e.status,
          branch: e.currentBranch?.name ?? null,
        },
        current: current ? figures(current) : null,
        previous: previous ? figures(previous) : null,
        incentives: [
          ...incentives
            .filter((i) => i.employeeId === e.id)
            .map((i) => ({
              name: i.type?.name ?? i.reason.split(': ')[0],
              amount: Number(i.amount),
              pending: false,
            })),
          ...pending
            .filter((p) => {
              const v = (p.payload ?? {}) as { month?: number; year?: number };
              return (
                p.employeeId === e.id && v.month === month && v.year === year
              );
            })
            .map((p) => ({
              name: p.summary,
              amount: Number((p.payload as { amount?: number }).amount) || 0,
              pending: true,
            })),
        ],
      };
    });
    return { year, month, previous: prev, rows };
  }

  /** Finance saves the month's figures (insert or update per doctor). */
  async save(
    year: number,
    month: number,
    rows: PerformanceRowInput[],
    user: Actor,
  ) {
    const ids = [...new Set(rows.map((r) => r.employeeId))];
    if (ids.length !== rows.length) {
      throw new BadRequestException('Each doctor can appear only once');
    }
    const titles = await this.doctorTitles();
    const found = await this.prisma.employee.findMany({
      where: { id: { in: ids }, currentDesignation: { in: titles } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException('Figures can only be saved for doctors');
    }
    await this.prisma.$transaction(
      rows.map((r) => {
        const data = {
          ...Object.fromEntries(FIGURE_KEYS.map((k) => [k, r[k]])),
          note: r.note?.trim() || null,
          updatedById: user.id,
        } as PerformanceFigures & { note: string | null; updatedById: string };
        return this.prisma.doctorMonthlyPerformance.upsert({
          where: {
            employeeId_year_month: { employeeId: r.employeeId, year, month },
          },
          create: { employeeId: r.employeeId, year, month, ...data },
          update: data,
        });
      }),
    );
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'DOCTOR_PERFORMANCE_SAVED',
        entity: 'DoctorMonthlyPerformance',
        entityId: `${year}-${String(month).padStart(2, '0')}`,
        changes: { year, month, doctors: rows.length } as Prisma.InputJsonValue,
      },
    });
    return this.list(year, month);
  }
}
