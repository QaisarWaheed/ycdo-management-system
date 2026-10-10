import { formatDuty12h } from '../../common/duty.util';

export const PAYSLIP_ORG_NAME = 'Youth Community Development Organization';

export interface PayslipSlipData {
  orgName: string;
  title: string;
  hospital: string;
  workPlace: string;
  phone: string;
  employeeId: string;
  cnic: string;
  employeeName: string;
  department: string;
  designation: string;
  /** Employee.status (e.g. ACTIVE, ON_REST) so signatories can see it on the slip */
  employeeStatus: string;
  period: string;
  payPeriod: string;
  totalDays: number;
  leaveDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  dutyTime: string;
  dutyHoursPerDay: number;
  presence: number;
  earnings: {
    stipend: number;
    contractualStipend: number;
    previousMonth: number;
    rewardOnProgress: number;
    rewards: number;
    otherAllowance: number;
    fuel: number;
    mobileLoad: number;
    extraDuty: number;
  };
  deductions: {
    advance: number;
    loan: number;
    mobileLoad: number;
    absence: number;
    fine: number;
    lateHour: number;
    health: number;
    providentFund: number;
    tax: number;
    auditDifference: number;
    /** Medicine Pending */
    staffPendingMed: number;
    kitchenPending: number;
    electricityBill: number;
    mobileBill: number;
    /** Catch-all for deduction reasons not covered by the fixed categories above, so nothing is silently dropped from the printed total. */
    other: number;
  };
  /** Every individual deduction row (reason + description + amount) so the payslip can show why pay was reduced, not just bucketed totals. */
  deductionItems: Array<{
    reason: string;
    description: string | null;
    amount: number;
  }>;
  /** Grouped, non-empty payslip lines (new layout); totals match earningsTotal / deductionsTotal. */
  sections?: PayslipSection[];
  earningsTotal: number;
  deductionsTotal: number;
  netPay: number;
  /** Alias of netPay for older clients */
  totalAmount: number;
  paidThrough: string;
}

export function formatSlipMoney(amount: number): string {
  if (!amount) return 'Nil';
  return String(Math.round(amount * 100) / 100);
}

export function formatSlipPeriod(month: number, year: number): string {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const fmt = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  };
  return `${fmt(start)} To ${fmt(end)}`;
}

export function formatSlipMonthTitle(month: number, year: number): string {
  const label = new Date(year, month - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  return `Stipend Slip Month Of ${label}`;
}

export function formatSlipDutyTime(emp: {
  dutyStartTime?: string | null;
  dutyEndTime?: string | null;
  shift?: { startTime: string; endTime: string } | null;
}): string {
  const start = emp.dutyStartTime ?? emp.shift?.startTime;
  const end = emp.dutyEndTime ?? emp.shift?.endTime;
  if (!start || !end) return 'Nil';
  try {
    return `${formatDuty12h(start)} To ${formatDuty12h(end)}`;
  } catch {
    return `${start} To ${end}`;
  }
}

export function computeEarningsTotal(earnings: PayslipSlipData['earnings']): number {
  return (
    earnings.stipend +
    earnings.previousMonth +
    earnings.rewardOnProgress +
    earnings.rewards +
    earnings.otherAllowance +
    earnings.fuel +
    earnings.mobileLoad +
    earnings.extraDuty
  );
}

export function computeDeductionsTotal(
  deductions: PayslipSlipData['deductions'],
): number {
  return (
    deductions.advance +
    deductions.loan +
    deductions.mobileLoad +
    deductions.absence +
    deductions.fine +
    deductions.lateHour +
    deductions.health +
    deductions.providentFund +
    deductions.tax +
    deductions.auditDifference +
    deductions.staffPendingMed +
    deductions.kitchenPending +
    deductions.electricityBill +
    deductions.mobileBill +
    deductions.other
  );
}

export function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/?*[\]]/g, ' ').trim() || fallback;
  return cleaned.slice(0, 31);
}

export type PayslipSectionKey = 'earnings' | 'attendance' | 'discipline' | 'other';

export interface PayslipSection {
  key: PayslipSectionKey;
  title: string;
  /** Only lines with an amount (Basic Stipend is always shown). */
  lines: Array<{ label: string; amount: number }>;
}

export const FINE_REASON_LABELS: Record<string, string> = {
  MOBILE_ON_DUTY: 'Fine: Mobile on duty',
  NO_UNIFORM: 'Fine: No uniform',
  LEFT_DUTY_POST: 'Fine: Leaving duty post',
  RULE_VIOLATION: 'Fine: Rule violation',
  OTHER: 'Fine: Other',
};

const EARLY_CHECKOUT_CARD = 'Attendance Card: every 3 Early Checkout';
const MISSING_CHECKOUT_CARD = 'Attendance Card: every 3 Missing Checkout';

type SlipDeductionRow = {
  reason: string;
  description?: string | null;
  amount: unknown;
  fineReason?: string | null;
};
type SlipAllowanceRow = { type: string; amount: unknown };

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Payslip grouped the way Accounts reads it: Pay & Allowances, Attendance
 * deductions, Discipline fines, Other deductions. Built from the same buckets
 * as `earnings` / `deductions`, so each section's lines add up to the slip
 * totals exactly; empty lines are dropped instead of printing "Nil".
 */
export function buildPayslipSections(input: {
  earnings: PayslipSlipData['earnings'];
  deductions: PayslipSlipData['deductions'];
  deductionRows: SlipDeductionRow[];
  allowanceRows: SlipAllowanceRow[];
  pkg: { allowances: number; fineDeduction: number };
  totalDays: number;
}): PayslipSection[] {
  const { earnings, deductions, deductionRows, allowanceRows, pkg } = input;
  const sum = (rows: Array<{ amount: unknown }>) =>
    money(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const keep = (lines: Array<{ label: string; amount: number }>) =>
    lines.filter((l) => Math.abs(l.amount) >= 0.005);

  // Pay & Allowances — split "otherAllowance" back into its parts.
  const overtime = sum(allowanceRows.filter((a) => a.type === 'OVERTIME'));
  const incentives = sum(allowanceRows.filter((a) => a.type === 'CUSTOM'));
  const otherAdditions = money(
    earnings.otherAllowance - pkg.allowances - overtime - incentives,
  );
  const dailyRate =
    earnings.contractualStipend && input.totalDays
      ? earnings.contractualStipend / input.totalDays
      : 0;
  const extraDays = dailyRate ? Math.round(earnings.extraDuty / dailyRate) : 0;
  const earningLines = [
    { label: 'Basic Stipend', amount: money(earnings.stipend) },
    ...keep([
      {
        label: extraDays > 0 ? `Extra Days (${extraDays})` : 'Extra Days',
        amount: money(earnings.extraDuty),
      },
      { label: 'Overtime', amount: overtime },
      { label: 'Incentives', amount: incentives },
      { label: 'Reward', amount: money(earnings.rewards) },
      { label: 'Reward On Progress', amount: money(earnings.rewardOnProgress) },
      { label: 'Petrol', amount: money(earnings.fuel) },
      { label: 'Travelling Exp', amount: money(pkg.allowances) },
      { label: 'Previous Month', amount: money(earnings.previousMonth) },
      { label: 'Mobile Load', amount: money(earnings.mobileLoad) },
      { label: 'Other Additions', amount: otherAdditions },
    ]),
  ];

  // Attendance deductions (absence, late, early / missed checkout).
  const disc = deductionRows.filter((d) => d.reason === 'DISCIPLINARY_FINE');
  const earlyCard = sum(
    disc.filter((d) => (d.description ?? '').startsWith(EARLY_CHECKOUT_CARD)),
  );
  const missedCard = sum(
    disc.filter((d) => (d.description ?? '').startsWith(MISSING_CHECKOUT_CARD)),
  );
  const attendanceLines = keep([
    { label: 'Absence', amount: money(deductions.absence) },
    { label: 'Late', amount: money(deductions.lateHour) },
    { label: 'Early checkout', amount: earlyCard },
    { label: 'Missed checkout', amount: missedCard },
  ]);

  // Discipline fines: manual fines by reason, other disciplinary fines, fixed package fine.
  const fineByReason = new Map<string, number>();
  for (const d of deductionRows.filter((r) => r.reason === 'FINE')) {
    const label = FINE_REASON_LABELS[d.fineReason ?? 'OTHER'] ?? FINE_REASON_LABELS.OTHER;
    fineByReason.set(label, money((fineByReason.get(label) ?? 0) + money(d.amount)));
  }
  const otherDisciplinary = money(
    sum(disc) - earlyCard - missedCard,
  );
  const disciplineLines = keep([
    ...[...fineByReason].map(([label, amount]) => ({ label, amount })),
    { label: 'Disciplinary action fine', amount: otherDisciplinary },
    { label: 'Fine (fixed)', amount: money(pkg.fineDeduction) },
  ]);

  const otherLines = keep([
    { label: 'Advance', amount: money(deductions.advance) },
    { label: 'Loan', amount: money(deductions.loan) },
    { label: 'Medicine Pending', amount: money(deductions.staffPendingMed) },
    { label: 'Kitchen Pending', amount: money(deductions.kitchenPending) },
    { label: 'Electricity Bill', amount: money(deductions.electricityBill) },
    { label: 'Mobile Bill', amount: money(deductions.mobileBill) },
    { label: 'Mobile Load', amount: money(deductions.mobileLoad) },
    { label: 'Health', amount: money(deductions.health) },
    { label: 'Provident Fund', amount: money(deductions.providentFund) },
    { label: 'Tax', amount: money(deductions.tax) },
    { label: 'Audit Difference', amount: money(deductions.auditDifference) },
    { label: 'Other', amount: money(deductions.other) },
  ]);

  return [
    { key: 'earnings', title: 'Pay & Allowances', lines: earningLines },
    { key: 'attendance', title: 'Attendance Deductions', lines: attendanceLines },
    { key: 'discipline', title: 'Discipline Fines', lines: disciplineLines },
    { key: 'other', title: 'Other Deductions', lines: otherLines },
  ];
}
