import { Injectable, NotFoundException } from '@nestjs/common';
import { loadAttendanceCard } from '../attendance/attendance-card.util';
import { INSTALLMENT_PREFIXES, installmentLoanId } from '../loans/loans.util';
import { AllowanceType, DeductionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { roundMoney } from './payroll-hours.util';

/** Audit entities that are money changes for an employee. */
const FINANCIAL_ENTITIES = [
  'StipendRecord',
  'EmployeeAllowance',
  'Incentive',
  'IncentivePlan',
  'PayChangeRequest',
  'PayrollEntry',
  'PayrollDeduction',
];

const AREA: Record<string, string> = {
  StipendRecord: 'Salary',
  EmployeeAllowance: 'Allowance',
  Incentive: 'Incentive',
  IncentivePlan: 'Incentive',
  PayChangeRequest: 'Pay approval',
  PayrollEntry: 'Payroll',
  PayrollDeduction: 'Deduction',
};

type Changes = Record<string, unknown> | null;
const pick = (c: Changes, keys: string[]) => {
  for (const k of keys) if (c && c[k] !== undefined && c[k] !== null) return c[k];
  return null;
};

/**
 * Phase 2 Req 1: one employee's money picture — month by month (basic,
 * allowances, incentives, overtime, extra duty, fines, other deductions, net,
 * letters), item lists with reasons, and every salary / allowance / incentive /
 * deduction change with before, after, date, reason and who did it.
 */
@Injectable()
export class EmployeeFinancialService {
  constructor(private prisma: PrismaService) {}

  async summary(employeeId: string) {
    const entries = await this.prisma.payrollEntry.findMany({
      where: { stipendRecord: { employeeId } },
      include: { deductions: true, allowances: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    const [incentives, allowanceRows, stipendRecords, letters] = await Promise.all([
      this.prisma.incentive.findMany({
        where: { employeeId },
        include: { type: { select: { name: true } } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      }),
      this.prisma.employeeAllowance.findMany({
        where: { employeeId },
        include: { type: { select: { name: true } } },
        orderBy: { startMonth: 'desc' },
      }),
      this.prisma.stipendRecord.findMany({ where: { employeeId }, select: { id: true } }),
      this.prisma.letter.findMany({
        where: { employeeId },
        select: { generatedAt: true },
      }),
    ]);

    // Month rows (segments of the same month are added together).
    type Month = {
      month: number;
      year: number;
      status: string;
      basic: number;
      allowances: number;
      incentives: number;
      overtime: number;
      extraDuty: number;
      fines: number;
      otherDeductions: number;
      net: number;
      letters: number;
    };
    const months = new Map<string, Month>();
    const deductions: Array<{
      month: number;
      year: number;
      reason: DeductionType;
      fineReason: string | null;
      description: string | null;
      amount: number;
    }> = [];
    const payments: Array<{
      month: number;
      year: number;
      type: AllowanceType;
      description: string | null;
      amount: number;
    }> = [];
    for (const e of entries) {
      const key = `${e.year}-${e.month}`;
      const m =
        months.get(key) ??
        ({
          month: e.month,
          year: e.year,
          status: e.status,
          basic: 0,
          allowances: 0,
          incentives: 0,
          overtime: 0,
          extraDuty: 0,
          fines: 0,
          otherDeductions: 0,
          net: 0,
          letters: 0,
        } as Month);
      m.basic += Number(e.basicStipend);
      m.net += Number(e.netStipend);
      for (const a of e.allowances) {
        const amount = Number(a.amount);
        if (a.type === AllowanceType.OVERTIME) m.overtime += amount;
        else if (
          a.type === AllowanceType.ADDITIONAL_WORKING_DAYS ||
          a.type === AllowanceType.RELIEVER
        )
          m.extraDuty += amount;
        else if (a.description?.startsWith('Incentive')) m.incentives += amount;
        else m.allowances += amount;
        payments.push({
          month: e.month,
          year: e.year,
          type: a.type,
          description: a.description,
          amount,
        });
      }
      // Package allowances (not stored as Allowance rows) are in totalAllowances.
      const rowSum = e.allowances.reduce((s, a) => s + Number(a.amount), 0);
      m.allowances += Math.max(0, Number(e.totalAllowances) - rowSum);
      for (const d of e.deductions) {
        const amount = Number(d.amount);
        if (d.reason === DeductionType.DISCIPLINARY_FINE) m.fines += amount;
        else m.otherDeductions += amount;
        deductions.push({
          month: e.month,
          year: e.year,
          reason: d.reason,
          fineReason: d.fineReason,
          description: d.description,
          amount,
        });
      }
      months.set(key, m);
    }
    for (const l of letters) {
      // Letters are dated in Pakistan time (UTC+5).
      const d = new Date(l.generatedAt.getTime() + 5 * 3600_000);
      const m = months.get(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);
      if (m) m.letters += 1;
    }
    const monthRows = [...months.values()].map((m) => ({
      ...m,
      basic: roundMoney(m.basic),
      allowances: roundMoney(m.allowances),
      incentives: roundMoney(m.incentives),
      overtime: roundMoney(m.overtime),
      extraDuty: roundMoney(m.extraDuty),
      fines: roundMoney(m.fines),
      otherDeductions: roundMoney(m.otherDeductions),
      net: roundMoney(m.net),
    }));
    const sum = (k: keyof Month) =>
      roundMoney(monthRows.reduce((s, m) => s + Number(m[k]), 0));

    return {
      totals: {
        fines: sum('fines'),
        otherDeductions: sum('otherDeductions'),
        incentives: sum('incentives'),
        allowances: sum('allowances'),
        overtime: sum('overtime'),
        extraDuty: sum('extraDuty'),
        net: sum('net'),
      },
      months: monthRows,
      deductions,
      payments,
      incentives: incentives.map((i) => ({
        id: i.id,
        month: i.month,
        year: i.year,
        type: i.type?.name ?? null,
        reason: i.reason,
        amount: Number(i.amount),
        recurring: !!i.planId,
      })),
      allowances: allowanceRows.map((a) => ({
        id: a.id,
        type: a.type.name,
        amount: Number(a.amount),
        startMonth: a.startMonth,
        startDay: a.startDay,
        endMonth: a.endMonth,
        endDay: a.endDay,
        note: a.note,
      })),
      history: await this.history(employeeId, {
        StipendRecord: stipendRecords.map((s) => s.id),
        EmployeeAllowance: allowanceRows.map((a) => a.id),
        Incentive: incentives.map((i) => i.id),
        PayrollEntry: entries.map((e) => e.id),
        PayrollDeduction: entries.flatMap((e) => e.deductions.map((d) => d.id)),
      }),
    };
  }

  /**
   * One page for Finance and approvers: who the employee is, the package,
   * this month's attendance, discipline, doctor performance, the last three
   * salaries and running loans, so no other screen needs opening.
   */
  async salaryProfile(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        photoUrl: true,
        cnic: true,
        phone: true,
        currentDesignation: true,
        status: true,
        joiningDate: true,
        dutyStartTime: true,
        dutyEndTime: true,
        payPackageVerifiedAt: true,
        currentBranch: { select: { name: true } },
        currentDepartment: { select: { name: true } },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const prev = month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };

    const [active, allowances, prevIncentives, letters, doctor, loans, money] =
      await Promise.all([
        this.prisma.stipendRecord.findFirst({
          where: { employeeId, effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
        }),
        this.prisma.employeeAllowance.findMany({
          where: {
            employeeId,
            startMonth: { lte: monthStart },
            OR: [{ endMonth: null }, { endMonth: { gte: monthStart } }],
          },
          include: { type: { select: { name: true } } },
        }),
        this.prisma.incentive.findMany({
          where: { employeeId, month: prev.month, year: prev.year },
          include: { type: { select: { name: true } } },
        }),
        this.prisma.letter.groupBy({
          by: ['letterType'],
          where: { employeeId, status: 'SENT' },
          _count: { _all: true },
        }),
        this.prisma.doctorMonthlyPerformance.findMany({
          where: { employeeId },
          orderBy: [{ year: 'desc' }, { month: 'desc' }],
          take: 3,
        }),
        this.prisma.employeeLoan.findMany({
          where: { employeeId, status: 'APPROVED' },
          orderBy: { createdAt: 'desc' },
        }),
        this.summary(employeeId),
      ]);

    // Repaid so far per loan, from its installment rows.
    const installments = loans.length
      ? await this.prisma.payrollDeduction.findMany({
          where: {
            OR: INSTALLMENT_PREFIXES.map((p) => ({ description: { startsWith: p } })),
            payrollEntry: { stipendRecord: { employeeId } },
          },
          select: { description: true, amount: true },
        })
      : [];
    const repaid = new Map<string, number>();
    for (const row of installments) {
      const id = installmentLoanId(row.description);
      if (id) repaid.set(id, (repaid.get(id) ?? 0) + Number(row.amount));
    }

    let attendance: Record<string, number> | null = null;
    try {
      const card = await loadAttendanceCard(this.prisma, employeeId, month, year);
      attendance = {
        present: card.present + (card.swapCovered ?? 0),
        late: card.late,
        absent: card.absent,
        uninformedAbsent: card.uninformedAbsent,
        onLeave: card.onLeave,
        halfDay: card.halfDay,
        missingCheckout: card.missingCheckout ?? 0,
        earlyCheckout: card.earlyCheckout ?? 0,
      };
    } catch {
      attendance = null; // A broken card must not hide the rest of the page.
    }

    return {
      employee,
      month: { month, year },
      package: active
        ? {
            basicStipend: Number(active.basicStipend),
            lumpsumTotal: active.lumpsumTotal != null ? Number(active.lumpsumTotal) : null,
            effectiveFrom: active.effectiveFrom,
            allowances: allowances.map((a) => ({ name: a.type.name, amount: Number(a.amount) })),
          }
        : null,
      previousMonthIncentives: {
        month: prev.month,
        year: prev.year,
        total: roundMoney(prevIncentives.reduce((s, i) => s + Number(i.amount), 0)),
        items: prevIncentives.map((i) => ({
          name: i.type?.name ?? 'Incentive',
          amount: Number(i.amount),
          reason: i.reason,
        })),
      },
      attendance,
      discipline: Object.fromEntries(letters.map((l) => [l.letterType, l._count._all])),
      doctorPerformance: doctor.map((d) => ({
        month: d.month,
        year: d.year,
        opdPatients: d.opdPatients,
        indoorPatients: d.indoorPatients,
        surgeries: d.surgeries,
        labTests: d.labTests,
        collection: Number(d.collection),
        labCollection: Number(d.labCollection),
      })),
      loans: loans.map((l) => ({
        id: l.id,
        kind: l.kind,
        amount: Number(l.amount),
        monthlyInstallment: Number(l.monthlyInstallment),
        remaining: Math.max(0, Number(l.amount) - (repaid.get(l.id) ?? 0)),
      })),
      lastMonths: money.months.slice(0, 3),
    };
  }

  /** Every money change: audit rows (before / after / reason) and payroll change logs. */
  private async history(employeeId: string, ids: Record<string, string[]>) {
    const [audits, changeLogs] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          entity: { in: FINANCIAL_ENTITIES },
          OR: [
            ...Object.entries(ids)
              .filter(([, list]) => list.length)
              .map(([entity, list]) => ({ entity, entityId: { in: list } })),
            // Rows deleted since (and plans / requests) carry the employee id.
            { changes: { path: ['employeeId'], equals: employeeId } },
          ],
        },
        include: { user: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.payrollChangeLog.findMany({
        where: { payrollEntry: { stipendRecord: { employeeId } } },
        include: {
          user: { select: { email: true } },
          payrollEntry: { select: { month: true, year: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);
    const rows = [
      ...audits.map((a) => {
        const c = (a.changes ?? null) as Changes;
        return {
          at: a.createdAt,
          by: a.user?.email ?? null,
          area: AREA[a.entity] ?? a.entity,
          entityId: a.entityId,
          action: a.action,
          before: pick(c, ['before', 'previousSalary', 'previousBasicStipend', 'previous', 'from']),
          after: pick(c, ['after', 'newBasicStipend', 'updated', 'to', 'amount']),
          reason: pick(c, ['reason', 'note', 'summary']) as string | null,
          details: c as Prisma.JsonValue,
        };
      }),
      ...changeLogs.map((l) => ({
        at: l.createdAt,
        by: l.user?.email ?? (l.userId ? null : 'System'),
        area: `Payroll ${l.payrollEntry.month}/${l.payrollEntry.year}`,
        entityId: l.payrollEntryId,
        action: l.action,
        before: l.netBefore == null ? null : Number(l.netBefore),
        after: l.netAfter == null ? null : Number(l.netAfter),
        reason: l.summary,
        details: (l.details ?? null) as Prisma.JsonValue,
      })),
    ];
    return rows.sort((a, b) => b.at.getTime() - a.at.getTime());
  }
}
