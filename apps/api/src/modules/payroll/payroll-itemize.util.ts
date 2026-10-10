import {
  CARD_EARLY_CHECKOUT_DESCRIPTION,
  CARD_MISSING_CHECKOUT_DESCRIPTION,
} from './attendance-card-salary.util';
import { FINE_REASON_LABELS } from './payslip-slip.util';

type Money = unknown;

export type ItemizeEntry = {
  basicStipend: Money;
  netStipend: Money;
  totalAllowances: Money;
  totalDeductions: Money;
  packageAllowanceLines?: unknown;
  deductions: Array<{
    reason: string;
    amount: Money;
    description?: string | null;
    fineReason?: string | null;
  }>;
  allowances: Array<{ type: string; amount: Money; description?: string | null }>;
  employee: {
    id: string;
    fullName: string;
    employeeCode: string;
    status?: string | null;
    currentDesignation?: string | null;
    currentBranch?: { name: string } | null;
    currentDepartment?: { name: string } | null;
  };
};

export type ItemizedRow = {
  employeeId: string;
  name: string;
  code: string;
  status: string | null;
  branch: string;
  department: string;
  designation: string;
  basic: number;
  net: number;
  allowances: Record<string, number>;
  incentives: Record<string, number>;
  deductions: Record<string, number>;
};

const num = (v: Money) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const titleCase = (s: string) => {
  const w = s.replace(/_/g, ' ').toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};
const add = (bucket: Record<string, number>, label: string, amount: number) => {
  if (Math.abs(amount) < 0.005) return;
  bucket[label] = r2((bucket[label] ?? 0) + amount);
};

const ALLOWANCE_LABELS: Record<string, string> = {
  OVERTIME: 'Overtime',
  ADDITIONAL_WORKING_DAYS: 'Extra days',
  RELIEVER: 'Reliever',
};

export function deductionReportLabel(d: {
  reason: string;
  description?: string | null;
  fineReason?: string | null;
}) {
  if (d.reason === 'FINE') return FINE_REASON_LABELS[d.fineReason ?? 'OTHER'] ?? 'Fine';
  if (d.reason === 'DISCIPLINARY_FINE') {
    const desc = d.description ?? '';
    if (desc.startsWith(CARD_EARLY_CHECKOUT_DESCRIPTION)) return 'Early checkout';
    if (desc.startsWith(CARD_MISSING_CHECKOUT_DESCRIPTION)) return 'Missed checkout';
    return 'Disciplinary fine';
  }
  if (d.reason === 'UNINFORMED_ABSENCE') return 'Absence';
  if (d.reason === 'LATE_ARRIVAL') return 'Late';
  return titleCase(d.reason);
}

/**
 * One row per employee for a month: every amount in the payroll entries
 * (several stipend segments are merged) split into allowance, incentive and
 * deduction lines. Lines add up to the stored entry totals: whatever is not a
 * stored row is the package part ("Package allowances" before the allowance
 * table, "Fixed package deductions").
 */
export function itemizePayrollEntries(
  entries: ItemizeEntry[],
  incentives: Array<{ employeeId: string; amount: Money; type?: { name: string } | null }>,
): ItemizedRow[] {
  const rows = new Map<string, ItemizedRow>();
  for (const e of entries) {
    const emp = e.employee;
    const row: ItemizedRow = rows.get(emp.id) ?? {
      employeeId: emp.id,
      name: emp.fullName,
      code: emp.employeeCode,
      status: emp.status ?? null,
      branch: emp.currentBranch?.name ?? '—',
      department: emp.currentDepartment?.name ?? 'No department',
      designation: emp.currentDesignation ?? 'No designation',
      basic: 0,
      net: 0,
      allowances: {},
      incentives: {},
      deductions: {},
    };
    rows.set(emp.id, row);
    row.basic = r2(row.basic + num(e.basicStipend));
    row.net = r2(row.net + num(e.netStipend));

    // Allowances: stored rows + package part.
    let storedAllowances = 0;
    for (const a of e.allowances) {
      const amount = num(a.amount);
      storedAllowances += amount;
      if (a.type === 'CUSTOM') {
        // Incentives come from the Incentive table (by type); other custom rows are manual additions.
        if (!(a.description ?? '').startsWith('Incentive: ')) {
          add(row.incentives, 'Manual addition', amount);
        }
        continue;
      }
      add(row.allowances, ALLOWANCE_LABELS[a.type] ?? titleCase(a.type), amount);
    }
    const packagePart = num(e.totalAllowances) - storedAllowances;
    const lines = Array.isArray(e.packageAllowanceLines)
      ? (e.packageAllowanceLines as Array<{ label: string; amount: number }>)
      : null;
    if (lines?.length) {
      for (const l of lines) add(row.allowances, l.label, num(l.amount));
      add(
        row.allowances,
        'Other package',
        packagePart - lines.reduce((s, l) => s + num(l.amount), 0),
      );
    } else {
      add(row.allowances, 'Package allowances', packagePart);
    }

    // Deductions: stored rows + fixed package deductions.
    let storedDeductions = 0;
    for (const d of e.deductions) {
      storedDeductions += num(d.amount);
      add(row.deductions, deductionReportLabel(d), num(d.amount));
    }
    add(row.deductions, 'Fixed package deductions', num(e.totalDeductions) - storedDeductions);
  }
  for (const i of incentives) {
    const row = rows.get(i.employeeId);
    if (row) add(row.incentives, i.type?.name ?? 'Incentive', num(i.amount));
  }
  return (
    [...rows.values()]
      // No working day / nothing paid or deducted → not part of the month's payroll.
      .filter(
        (r) =>
          r.basic !== 0 ||
          Object.keys(r.allowances).length > 0 ||
          Object.keys(r.incentives).length > 0 ||
          Object.keys(r.deductions).length > 0,
      )
      .sort(
        (a, b) =>
          a.department.localeCompare(b.department) ||
          a.designation.localeCompare(b.designation) ||
          a.name.localeCompare(b.name),
      )
  );
}
