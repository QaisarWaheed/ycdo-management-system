import { formatDuty12h } from '../../common/duty.util';
import {
  formatDayList,
  unpaidDayParts,
  type PayslipDayDetails,
} from './payslip-day-details.util';

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
  /** Employee photo URL for the slip header. */
  photoUrl?: string | null;
  deductions: {
    /** Basic for days not paid (absent / unpaid / before joining), so Basic shows the full contract. */
    unpaidBasic?: number;
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
  /** Where every day of the month went + the dates behind each line. */
  dayDetails?: PayslipDayDetails;
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
    deductions.other +
    (deductions.unpaidBasic ?? 0)
  );
}

export function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/?*[\]]/g, ' ').trim() || fallback;
  return cleaned.slice(0, 31);
}

export type PayslipSectionKey = 'earnings' | 'attendance' | 'discipline' | 'other';

export interface PayslipLine {
  label: string;
  amount: number;
  /** What it is for (days, hours, reason) — printed next to the label. */
  note?: string;
}

export interface PayslipSection {
  key: PayslipSectionKey;
  title: string;
  /** Only lines with an amount (Basic Stipend is always shown). */
  lines: PayslipLine[];
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
type SlipAllowanceRow = {
  type: string;
  amount: unknown;
  description?: string | null;
  hours?: unknown;
};

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? one : many}`;
const titleCase = (s: string) => {
  const w = s.replace(/_/g, ' ').toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};
/** Hand-entered notes only; system text ("Attendance Card: …") is replaced by counts. */
const humanNote = (d?: string | null) => {
  const t = (d ?? '').trim();
  return t && !t.startsWith('Attendance Card') ? t : undefined;
};

type DeductionBucket = keyof PayslipSlipData['deductions'];

function deductionBucket(d: SlipDeductionRow): DeductionBucket {
  switch (d.reason) {
    case 'UNINFORMED_ABSENCE':
    case 'UNPAID_LEAVE':
    case 'HALF_DAY':
      return 'absence';
    case 'DISCIPLINARY_FINE':
    case 'FINE':
      return 'fine';
    case 'LATE_ARRIVAL':
      return 'lateHour';
    case 'LOAN':
      return 'loan';
    case 'ADVANCE':
      return 'advance';
    case 'MEDICINE_PENDING':
      return 'staffPendingMed';
    case 'KITCHEN_PENDING':
      return 'kitchenPending';
    case 'ELECTRICITY_BILL':
      return 'electricityBill';
    case 'MOBILE_BILL':
      return 'mobileBill';
    default:
      return d.reason === 'OTHER' && (d.description ?? '').startsWith('Unmarked day')
        ? 'absence'
        : 'other';
  }
}

/**
 * Payslip grouped the way Accounts reads it: Pay & Allowances, Attendance,
 * Discipline fines, Other deductions. Every non-basic line carries what it is
 * for (days, hours or the note Finance wrote). Each bucket's rows are listed
 * one by one and whatever is left of the bucket is the monthly package part,
 * so the sections always add up to the slip totals; empty lines are dropped.
 */
export function buildPayslipSections(input: {
  earnings: PayslipSlipData['earnings'];
  deductions: PayslipSlipData['deductions'];
  deductionRows: SlipDeductionRow[];
  allowanceRows: SlipAllowanceRow[];
  pkg: { allowances: number; fineDeduction: number };
  /** Allowance-table months: one line per allowance type, replacing the old fixed lines. */
  packageLines?: Array<{ label: string; amount: number }>;
  totalDays: number;
  /** Days of Basic not paid (absent, unpaid leave, before joining). */
  unpaidDays?: number;
  /** The month is still running: unpaid days include days not reached yet. */
  monthInProgress?: boolean;
  counts?: {
    late?: number;
    earlyCheckout?: number;
    missingCheckout?: number;
    uninformedAbsent?: number;
  };
  /** Dates for the notes and the split of days not paid. */
  dayDetails?: PayslipDayDetails;
}): PayslipSection[] {
  const { earnings, deductions, deductionRows, allowanceRows, pkg } = input;
  const counts = input.counts ?? {};
  const dd = input.dayDetails?.dates;
  /** "6 lates: 2, 5, 9 Sep" — count from the Card, dates when known. */
  const withDates = (head: string | undefined, dates?: string[]) => {
    const list = dates?.length ? formatDayList(dates) : '';
    return head && list ? `${head}: ${list}` : head || list || undefined;
  };
  const sum = (rows: Array<{ amount: unknown }>) =>
    money(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));

  // Same label + note lines are added together; zero lines dropped.
  const collect = (lines: PayslipLine[]) => {
    const out: PayslipLine[] = [];
    for (const l of lines) {
      const amount = money(l.amount);
      if (Math.abs(amount) < 0.005) continue;
      const same = out.find((o) => o.label === l.label && o.note === l.note);
      if (same) same.amount = money(same.amount + amount);
      else out.push({ label: l.label, amount, ...(l.note ? { note: l.note } : {}) });
    }
    return out;
  };

  // ── Pay & Allowances
  const overtimeRows = allowanceRows.filter((a) => a.type === 'OVERTIME');
  const overtimeHours = overtimeRows.reduce((s, a) => s + (Number(a.hours) || 0), 0);
  const customRows = allowanceRows.filter((a) => a.type === 'CUSTOM');
  const packageLines = (input.packageLines ?? []).map((l) => ({
    label: l.label,
    amount: money(l.amount),
  }));
  const packageTotal = packageLines.reduce((s, l) => s + l.amount, 0);
  const otherAdditions = money(
    earnings.otherAllowance - pkg.allowances - packageTotal - sum(overtimeRows) - sum(customRows),
  );
  const dailyRate =
    earnings.contractualStipend && input.totalDays
      ? earnings.contractualStipend / input.totalDays
      : 0;
  const extraDays = dailyRate ? Math.round((earnings.extraDuty / dailyRate) * 10) / 10 : 0;

  const earningLines: PayslipLine[] = [
    { label: 'Basic Stipend', amount: money(earnings.stipend) },
    ...collect([
      {
        label: 'Extra Days',
        amount: earnings.extraDuty,
        note: withDates(
          extraDays > 0 ? plural(extraDays, 'day') : undefined,
          dd?.extraDays.map((x) => (x.note ? `${x.date} (${x.note})` : x.date)),
        ),
      },
      {
        label: 'Overtime',
        amount: sum(overtimeRows),
        note: withDates(
          overtimeHours > 0 ? plural(Math.round(overtimeHours * 10) / 10, 'hour') : undefined,
          dd?.overtime.map((o) => `${o.date} ${o.hours}h`),
        ),
      },
      ...customRows.map((a) => {
        const desc = (a.description ?? '').trim();
        return desc.startsWith('Incentive: ')
          ? {
              label: 'Incentive',
              amount: Number(a.amount) || 0,
              note: desc.slice(11).trim() || undefined,
            }
          : { label: 'Addition', amount: Number(a.amount) || 0, note: desc || undefined };
      }),
      { label: 'Reward', amount: earnings.rewards },
      { label: 'Reward On Progress', amount: earnings.rewardOnProgress },
      { label: 'Petrol', amount: earnings.fuel },
      { label: 'Travelling Exp', amount: pkg.allowances },
      ...packageLines,
      { label: 'Previous Month', amount: earnings.previousMonth },
      { label: 'Mobile Load', amount: earnings.mobileLoad },
      { label: 'Other Additions', amount: otherAdditions },
    ]),
  ];

  // ── Deductions: rows one by one, bucket remainder = monthly package part
  const attendance: PayslipLine[] = unpaidBasicLines(
    deductions.unpaidBasic ?? 0,
    input.unpaidDays ?? 0,
    input.monthInProgress,
    input.dayDetails,
  );
  const discipline: PayslipLine[] = [];
  const other: PayslipLine[] = [];
  const used: Partial<Record<DeductionBucket, number>> = {};
  const every3 = (n: number | undefined, one: string, dates?: string[]) =>
    n ? `${withDates(plural(n, one), dates)} (every 3 = 1 day)` : undefined;
  const absences = dd ? [...dd.absent, ...dd.uninformedAbsent] : [];

  for (const d of deductionRows) {
    const amount = Number(d.amount) || 0;
    const bucket = deductionBucket(d);
    used[bucket] = (used[bucket] ?? 0) + amount;
    const desc = d.description ?? '';
    if (bucket === 'absence') {
      attendance.push({
        label: 'Absence fine',
        amount,
        note: absences.length
          ? withDates(plural(absences.length, 'absence', 'absences'), absences)
          : counts.uninformedAbsent
            ? plural(counts.uninformedAbsent, 'uninformed absence', 'uninformed absences')
            : humanNote(desc),
      });
    } else if (bucket === 'lateHour') {
      attendance.push({ label: 'Late', amount, note: every3(counts.late, 'late', dd?.late) ?? humanNote(desc) });
    } else if (d.reason === 'DISCIPLINARY_FINE' && desc.startsWith(EARLY_CHECKOUT_CARD)) {
      attendance.push({
        label: 'Early checkout',
        amount,
        note: every3(counts.earlyCheckout, 'early checkout', dd?.earlyCheckout),
      });
    } else if (d.reason === 'DISCIPLINARY_FINE' && desc.startsWith(MISSING_CHECKOUT_CARD)) {
      attendance.push({
        label: 'Missed checkout',
        amount,
        note: every3(counts.missingCheckout, 'missed checkout', dd?.missedCheckout),
      });
    } else if (d.reason === 'FINE') {
      discipline.push({
        label: FINE_REASON_LABELS[d.fineReason ?? 'OTHER'] ?? FINE_REASON_LABELS.OTHER,
        amount,
        note: humanNote(desc),
      });
    } else if (d.reason === 'DISCIPLINARY_FINE') {
      discipline.push({ label: 'Disciplinary action fine', amount, note: humanNote(desc) });
    } else {
      other.push({ label: titleCase(d.reason), amount, note: humanNote(desc) });
    }
  }

  const rest = (bucket: DeductionBucket) =>
    money((Number(deductions[bucket]) || 0) - (used[bucket] ?? 0));
  const packageNote = 'monthly package';
  attendance.push(
    { label: 'Absence fine', amount: rest('absence') },
    { label: 'Late', amount: rest('lateHour') },
  );
  discipline.push({ label: 'Fine (fixed)', amount: rest('fine'), note: packageNote });
  other.push(
    { label: 'Advance', amount: rest('advance'), note: packageNote },
    { label: 'Loan', amount: rest('loan'), note: packageNote },
    { label: 'Medicine Pending', amount: rest('staffPendingMed') },
    { label: 'Kitchen Pending', amount: rest('kitchenPending') },
    { label: 'Electricity Bill', amount: rest('electricityBill') },
    { label: 'Mobile Bill', amount: rest('mobileBill') },
    { label: 'Mobile Load', amount: deductions.mobileLoad },
    { label: 'Health', amount: deductions.health, note: packageNote },
    { label: 'Provident Fund', amount: deductions.providentFund },
    { label: 'Tax', amount: deductions.tax },
    { label: 'Audit Difference', amount: deductions.auditDifference },
    { label: 'Other', amount: rest('other') },
  );

  return [
    { key: 'earnings', title: 'Pay & Allowances', lines: earningLines },
    { key: 'attendance', title: 'Attendance Deductions', lines: collect(attendance) },
    { key: 'discipline', title: 'Discipline Fines', lines: collect(discipline) },
    { key: 'other', title: 'Other Deductions', lines: collect(other) },
  ];
}

/**
 * Basic for days not paid, one line per cause (before joining, unpaid leave,
 * absent dates, …) split by days so the lines add up exactly. Time not
 * covered by a day cause (short hours) gets its own line; if the causes do
 * not fit the figure payroll used, one line lists them instead.
 */
function unpaidBasicLines(
  amount: number,
  unpaidDays: number,
  monthInProgress: boolean | undefined,
  details: PayslipDayDetails | undefined,
): PayslipLine[] {
  const fallback = (note?: string): PayslipLine[] => [
    {
      label: 'Absence',
      amount,
      note:
        note ??
        (unpaidDays
          ? monthInProgress
            ? `${plural(unpaidDays, 'day')} not paid yet (month still running)`
            : `${plural(unpaidDays, 'day')} not paid`
          : undefined),
    },
  ];
  if (!details || !unpaidDays || amount <= 0) return fallback();
  const parts = unpaidDayParts(details);
  const partDays = parts.reduce((s, p) => s + p.days, 0);
  const short = Math.round((unpaidDays - partDays) * 10) / 10;
  if (short < -0.05)
    return fallback(
      `${plural(unpaidDays, 'day')} not paid: ` +
        parts.map((p) => `${p.label.toLowerCase()} ${plural(p.days, 'day')}`).join(', '),
    );
  if (short > 0.05) parts.push({ label: 'Short hours', days: short, note: 'late / early hours not worked' });
  if (!parts.length) return fallback();
  const rate = amount / unpaidDays;
  let left = money(amount);
  return parts.map((p, i) => {
    const value = i === parts.length - 1 ? left : money(p.days * rate);
    left = money(left - value);
    return {
      label: p.label,
      amount: value,
      note: [plural(p.days, 'day'), p.note].filter(Boolean).join(': '),
    };
  });
}
