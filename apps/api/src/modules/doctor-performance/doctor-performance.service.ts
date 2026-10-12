import * as fs from 'fs';
import * as path from 'path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BranchShift,
  EmployeeStatus,
  PayChangeKind,
  PayChangeStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveUploadPath } from '../documents/documents.service';
import {
  FIGURE_KEYS,
  isDoctorDesignation,
  previousMonth,
  type PerformanceFigures,
} from './doctor-performance.util';

type Actor = { id: string };
export type BranchShiftRowInput = {
  branchId: string;
  shift: BranchShift;
  patients: number;
  labCollection: number;
  collection: number;
  note?: string | null;
};

const shiftFigures = (r: {
  patients: number;
  labCollection: Prisma.Decimal | number;
  collection: Prisma.Decimal | number;
  note: string | null;
}) => ({
  patients: r.patients,
  labCollection: Number(r.labCollection),
  collection: Number(r.collection),
  note: r.note,
});
export type PerformanceRowInput = PerformanceFigures & {
  employeeId: string;
  note?: string | null;
};

const figures = (r: {
  opdPatients: number;
  indoorPatients: number;
  surgeries: number;
  labTests: number;
  labCollection: Prisma.Decimal | number;
  collection: Prisma.Decimal | number;
  note: string | null;
}) => ({
  opdPatients: r.opdPatients,
  indoorPatients: r.indoorPatients,
  surgeries: r.surgeries,
  labTests: r.labTests,
  labCollection: Number(r.labCollection),
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

    const [records, incentives, pending, prevIncentives] = await Promise.all([
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
      // Last month's incentives, shown beside the comparison.
      this.prisma.incentive.groupBy({
        by: ['employeeId'],
        where: { employeeId: { in: ids }, year: prev.year, month: prev.month },
        _sum: { amount: true },
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
          branchId: e.currentBranch?.id ?? null,
        },
        current: current ? figures(current) : null,
        previous: previous ? figures(previous) : null,
        previousIncentive: Number(
          prevIncentives.find((g) => g.employeeId === e.id)?._sum.amount ?? 0,
        ),
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

  /**
   * Branch figures by shift (this month vs last), the uploaded progress
   * report, and each branch's Admin Officers with their incentives.
   */
  async branches(year: number, month: number) {
    const prev = previousMonth(year, month);
    const months = [
      { year, month },
      { year: prev.year, month: prev.month },
    ];
    const [branches, records, reports, officers] = await Promise.all([
      this.prisma.branch.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.branchShiftPerformance.findMany({ where: { OR: months } }),
      this.prisma.branchProgressReport.findMany({
        where: { year, month },
        select: { id: true, branchId: true, fileName: true },
      }),
      this.prisma.employee.findMany({
        where: {
          currentDesignation: { contains: 'admin officer', mode: 'insensitive' },
          status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] },
        },
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          currentDesignation: true,
          currentBranchId: true,
        },
        orderBy: { fullName: 'asc' },
      }),
    ]);
    const officerIds = officers.map((o) => o.id);
    const totals = (m: { year: number; month: number }) =>
      officerIds.length
        ? this.prisma.incentive.groupBy({
            by: ['employeeId'],
            where: { employeeId: { in: officerIds }, ...m },
            _sum: { amount: true },
          })
        : Promise.resolve([]);
    const [now, before] = await Promise.all([totals(months[0]), totals(months[1])]);
    const sum = (rows: typeof now, id: string) =>
      Number(rows.find((g) => g.employeeId === id)?._sum.amount ?? 0);
    const find = (branchId: string, shift: BranchShift, y: number, m: number) => {
      const r = records.find(
        (x) =>
          x.branchId === branchId && x.shift === shift && x.year === y && x.month === m,
      );
      return r ? shiftFigures(r) : null;
    };
    return {
      year,
      month,
      previous: prev,
      rows: branches.map((b) => ({
        branch: b,
        shifts: [BranchShift.DAY, BranchShift.NIGHT].map((shift) => ({
          shift,
          current: find(b.id, shift, year, month),
          previous: find(b.id, shift, prev.year, prev.month),
        })),
        report: reports.find((r) => r.branchId === b.id) ?? null,
        adminOfficers: officers
          .filter((o) => o.currentBranchId === b.id)
          .map((o) => ({
            id: o.id,
            fullName: o.fullName,
            employeeCode: o.employeeCode,
            designation: o.currentDesignation,
            incentive: sum(now, o.id),
            previousIncentive: sum(before, o.id),
          })),
      })),
    };
  }

  /** Finance saves branch figures (insert or update per branch and shift). */
  async saveBranches(
    year: number,
    month: number,
    rows: BranchShiftRowInput[],
    user: Actor,
  ) {
    const keys = new Set(rows.map((r) => `${r.branchId}:${r.shift}`));
    if (keys.size !== rows.length) {
      throw new BadRequestException('Each branch shift can appear only once');
    }
    await this.prisma.$transaction(
      rows.map((r) => {
        const data = {
          patients: r.patients,
          labCollection: r.labCollection,
          collection: r.collection,
          note: r.note?.trim() || null,
          updatedById: user.id,
        };
        return this.prisma.branchShiftPerformance.upsert({
          where: {
            branchId_year_month_shift: {
              branchId: r.branchId,
              year,
              month,
              shift: r.shift,
            },
          },
          create: { branchId: r.branchId, year, month, shift: r.shift, ...data },
          update: data,
        });
      }),
    );
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'BRANCH_PERFORMANCE_SAVED',
        entity: 'BranchShiftPerformance',
        entityId: `${year}-${String(month).padStart(2, '0')}`,
        changes: { year, month, rows: rows.length } as Prisma.InputJsonValue,
      },
    });
    return this.branches(year, month);
  }

  /** Store the month's progress report for a branch (replaces an older one). */
  async saveReport(
    branchId: string,
    year: number,
    month: number,
    file: Express.Multer.File,
    user: Actor,
  ) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true },
    });
    if (!branch) {
      fs.rmSync(file.path, { force: true });
      throw new BadRequestException('Branch not found');
    }
    const fileUrl = `/uploads/branch-reports/${path.basename(file.path)}`;
    const where = { branchId_year_month: { branchId, year, month } };
    const old = await this.prisma.branchProgressReport.findUnique({ where });
    const data = { fileName: file.originalname, fileUrl, uploadedById: user.id };
    const saved = await this.prisma.branchProgressReport.upsert({
      where,
      create: { branchId, year, month, ...data },
      update: data,
      select: { id: true, branchId: true, fileName: true },
    });
    if (old && old.fileUrl !== fileUrl) {
      fs.rmSync(path.join(process.cwd(), old.fileUrl.replace(/^\/+/, '')), {
        force: true,
      });
    }
    return saved;
  }

  async openReport(id: string) {
    const report = await this.prisma.branchProgressReport.findUnique({
      where: { id },
    });
    if (!report) throw new NotFoundException('Report not found');
    return {
      fileName: report.fileName,
      stream: fs.createReadStream(resolveUploadPath(report.fileUrl)),
    };
  }
}
