import { Injectable } from '@nestjs/common';
import {
  AllowanceType,
  DeductionType,
  ExtraTimeStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScopeService } from '../permissions/access-scope.service';
import { loadAttendanceCard } from '../attendance/attendance-card.util';
import { aggregateMonthlyPayrollByEmployee } from './payroll-aggregate.util';
import { roundMoney } from './payroll-hours.util';
import {
  CARD_EARLY_CHECKOUT_DESCRIPTION,
  CARD_MISSING_CHECKOUT_DESCRIPTION,
} from './attendance-card-salary.util';

type Money = {
  otHours: number;
  otAmount: number;
  extraDutyDays: number;
  extraDutyAmount: number;
  attendanceDeductions: number;
  fines: number;
  otherDeductions: number;
  totalDeductions: number;
  net: number;
};

export type OvertimeReportRow = Money & {
  employeeId: string;
  code: string;
  name: string;
  branchId: string | null;
  branch: string;
  departmentId: string | null;
  department: string;
};

export type OvertimeGroupTotal = Money & {
  id: string | null;
  name: string;
  employees: number;
};

const MONEY_KEYS: Array<keyof Money> = [
  'otHours',
  'otAmount',
  'extraDutyDays',
  'extraDutyAmount',
  'attendanceDeductions',
  'fines',
  'otherDeductions',
  'totalDeductions',
  'net',
];
const zero = (): Money =>
  Object.fromEntries(MONEY_KEYS.map((k) => [k, 0])) as Money;

const EXTRA_DUTY_TYPES: AllowanceType[] = [
  AllowanceType.ADDITIONAL_WORKING_DAYS,
  AllowanceType.RELIEVER,
];

/** Same categories as the payslip: card attendance money vs fines vs everything else. */
export function overtimeDeductionCategory(d: {
  reason: string;
  description?: string | null;
}): 'attendance' | 'fine' | 'other' {
  const desc = d.description ?? '';
  switch (d.reason) {
    case DeductionType.UNINFORMED_ABSENCE:
    case DeductionType.UNPAID_LEAVE:
    case DeductionType.HALF_DAY:
    case DeductionType.LATE_ARRIVAL:
      return 'attendance';
    case DeductionType.DISCIPLINARY_FINE:
      return desc.startsWith(CARD_EARLY_CHECKOUT_DESCRIPTION) ||
        desc.startsWith(CARD_MISSING_CHECKOUT_DESCRIPTION)
        ? 'attendance'
        : 'fine';
    case DeductionType.FINE:
      return 'fine';
    default:
      return d.reason === DeductionType.OTHER && desc.startsWith('Unmarked day')
        ? 'attendance'
        : 'other';
  }
}

function addInto(target: Money, src: Money) {
  for (const k of MONEY_KEYS) target[k] = roundMoney(target[k] + src[k]);
}

function groupTotals(
  rows: OvertimeReportRow[],
  key: 'branch' | 'department',
): OvertimeGroupTotal[] {
  const map = new Map<string, OvertimeGroupTotal>();
  for (const r of rows) {
    const id = key === 'branch' ? r.branchId : r.departmentId;
    const k = id ?? `none:${r[key]}`;
    const g = map.get(k) ?? { ...zero(), id, name: r[key], employees: 0 };
    addInto(g, r);
    g.employees++;
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) => b.otAmount - a.otAmount);
}

/** The 6 (month, year) pairs ending at the selected month, oldest first. */
export function lastSixMonths(month: number, year: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - (5 - i), 1));
    return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
  });
}

/**
 * Month-end overtime report built from the month's payroll entries (segments
 * merged with the Monthly Payroll rules), so amounts match salary records.
 */
@Injectable()
export class OvertimeReportService {
  constructor(
    private prisma: PrismaService,
    private accessScopeService: AccessScopeService,
  ) {}

  async report(
    q: {
      month: number;
      year: number;
      branchId?: string;
      departmentId?: string;
    },
    actor?: { id: string; role: UserRole },
  ) {
    let employee: Prisma.EmployeeWhereInput = {
      ...(q.branchId ? { currentBranchId: q.branchId } : {}),
      ...(q.departmentId ? { currentDepartmentId: q.departmentId } : {}),
    };
    if (actor?.id) {
      employee = await this.accessScopeService.narrowEmployeeWhereForActor(
        actor.id,
        actor.role,
        employee,
      );
    }

    const entries = await this.prisma.payrollEntry.findMany({
      where: { month: q.month, year: q.year, stipendRecord: { employee } },
      include: {
        deductions: true,
        allowances: true,
        stipendRecord: {
          select: {
            employeeId: true,
            effectiveFrom: true,
            effectiveTo: true,
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                currentBranchId: true,
                currentDepartmentId: true,
                currentBranch: { select: { name: true } },
                currentDepartment: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    const merged = aggregateMonthlyPayrollByEmployee(entries);

    const employeeIds = merged.map((e) => e.stipendRecord.employee.id);
    const awd = employeeIds.length
      ? await this.prisma.additionalWorkingDay.findMany({
          where: {
            employeeId: { in: employeeIds },
            status: ExtraTimeStatus.APPROVED,
            date: {
              gte: new Date(Date.UTC(q.year, q.month - 1, 1)),
              lt: new Date(Date.UTC(q.year, q.month, 1)),
            },
          },
          select: { employeeId: true },
        })
      : [];
    const extraDays = new Map<string, number>();
    for (const a of awd)
      extraDays.set(a.employeeId, (extraDays.get(a.employeeId) ?? 0) + 1);

    const rows: OvertimeReportRow[] = [];
    for (const e of merged) {
      const emp = e.stipendRecord.employee;
      const ot = e.allowances.filter((a) => a.type === AllowanceType.OVERTIME);
      const otAmount = roundMoney(ot.reduce((s, a) => s + Number(a.amount), 0));
      let otHours = roundMoney(
        ot.reduce((s, a) => s + Number(a.hours ?? 0), 0),
      );
      // Card rows always store hours; older rows without hours fall back to the Card.
      if (otAmount > 0 && ot.some((a) => a.hours == null)) {
        otHours = (
          await loadAttendanceCard(this.prisma, emp.id, q.month, q.year)
        ).overtimeHours;
      }
      const extraDutyAmount = roundMoney(
        e.allowances
          .filter((a) => EXTRA_DUTY_TYPES.includes(a.type))
          .reduce((s, a) => s + Number(a.amount), 0),
      );
      const extraDutyDays = extraDays.get(emp.id) ?? 0;

      const cat = { attendance: 0, fine: 0, other: 0 };
      for (const d of e.deductions)
        cat[overtimeDeductionCategory(d)] += Number(d.amount);
      const totalDeductions = roundMoney(cat.attendance + cat.fine + cat.other);
      // Req 6: everyone with overtime, extra duty or any deduction, so the
      // month's deduction total is complete too.
      if (!otAmount && !otHours && !extraDutyAmount && !extraDutyDays && !totalDeductions)
        continue;
      rows.push({
        employeeId: emp.id,
        code: emp.employeeCode ?? '',
        name: emp.fullName,
        branchId: emp.currentBranchId ?? null,
        branch: emp.currentBranch?.name ?? '—',
        departmentId: emp.currentDepartmentId ?? null,
        department: emp.currentDepartment?.name ?? '—',
        otHours,
        otAmount,
        extraDutyDays,
        extraDutyAmount,
        attendanceDeductions: roundMoney(cat.attendance),
        fines: roundMoney(cat.fine),
        otherDeductions: roundMoney(cat.other),
        totalDeductions,
        net: roundMoney(otAmount + extraDutyAmount - totalDeductions),
      });
    }

    const totals = zero();
    for (const r of rows) addInto(totals, r);

    return {
      month: q.month,
      year: q.year,
      rows,
      byBranch: groupTotals(rows, 'branch'),
      byDepartment: groupTotals(rows, 'department'),
      totals: { ...totals, employees: rows.length },
      // The selected month's point is the report's own grand total.
      trend: await this.trend(q.month, q.year, employee, {
        month: q.month,
        year: q.year,
        otAmount: totals.otAmount,
        extraDutyAmount: totals.extraDutyAmount,
        totalDeductions: totals.totalDeductions,
      }),
    };
  }

  /** OT, extra duty and deductions per month for the 6 months ending at the selected one (same scope/filters). */
  private async trend(
    month: number,
    year: number,
    employee: Prisma.EmployeeWhereInput,
    current: {
      month: number;
      year: number;
      otAmount: number;
      extraDutyAmount: number;
      totalDeductions: number;
    },
  ) {
    const months = lastSixMonths(month, year);
    const earlier = months.slice(0, -1);
    const entries = await this.prisma.payrollEntry.findMany({
      where: { OR: earlier, stipendRecord: { employee } },
      include: {
        allowances: {
          where: { type: { in: [AllowanceType.OVERTIME, ...EXTRA_DUTY_TYPES] } },
        },
        deductions: { select: { amount: true } },
        stipendRecord: {
          select: { employeeId: true, effectiveFrom: true, effectiveTo: true },
        },
      },
    });
    return [
      ...earlier.map((m) => {
        const merged = aggregateMonthlyPayrollByEmployee(
          entries.filter((e) => e.month === m.month && e.year === m.year),
        );
        const sum = (types: AllowanceType[]) =>
          roundMoney(
            merged
              .flatMap((e) => e.allowances)
              .filter((a) => types.includes(a.type))
              .reduce((s, a) => s + Number(a.amount), 0),
          );
        return {
          ...m,
          otAmount: sum([AllowanceType.OVERTIME]),
          extraDutyAmount: sum(EXTRA_DUTY_TYPES),
          totalDeductions: roundMoney(
            merged
              .flatMap((e) => e.deductions)
              .reduce((s, d) => s + Number(d.amount), 0),
          ),
        };
      }),
      current,
    ];
  }
}
