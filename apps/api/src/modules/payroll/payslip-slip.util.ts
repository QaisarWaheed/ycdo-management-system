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
    health: number;
    providentFund: number;
    tax: number;
    auditDifference: number;
    staffPendingMed: number;
    /** Catch-all for deduction reasons not covered by the fixed categories above, so nothing is silently dropped from the printed total. */
    other: number;
  };
  /** Every individual deduction row (reason + description + amount) so the payslip can show why pay was reduced, not just bucketed totals. */
  deductionItems: Array<{
    reason: string;
    description: string | null;
    amount: number;
  }>;
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
    deductions.health +
    deductions.providentFund +
    deductions.tax +
    deductions.auditDifference +
    deductions.staffPendingMed +
    deductions.other
  );
}

export function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/?*[\]]/g, ' ').trim() || fallback;
  return cleaned.slice(0, 31);
}
