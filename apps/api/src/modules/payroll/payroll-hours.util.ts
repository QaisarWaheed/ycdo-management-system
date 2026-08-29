import {
  getDutyWindow,
  type DutyWindow,
  workedMinutes,
} from '../../common/duty.util';

const PK_OFFSET_MS = 5 * 60 * 60 * 1000;

export interface HourlyPayrollBreakdown {
  contractualBasicStipend: number;
  dailyDutyHours: number;
  daysInMonth: number;
  scheduledHours: number;
  hourlyRate: number;
  workedMinutes: number;
  workedHours: number;
  paidLeaveMinutes: number;
  paidLeaveHours: number;
  /**
   * Full scheduled-day credit for days where an explicit disciplinary
   * deduction (or its absence) is the sole intended monetary consequence —
   * LATE, ABSENT, UNINFORMED_ABSENT, unpaid
   * REGULAR leave, HALF_DAY (half-day pay is a PayrollDeduction row), and missing-checkout/24h-checkout-less days. Kept
   * separate from workedMinutes (actual clocked time) and paidLeaveMinutes
   * (leave credit) so those two keep their literal meaning for display,
   * while still counting fully toward payableMinutes/hourlyBasicEarned.
   */
  policyCreditMinutes: number;
  policyCreditHours: number;
  creditedAttendanceDays: number;
  payableMinutes: number;
  payableHours: number;
  hourlyBasicEarned: number;
  /**
   * Persisted Monthly Payroll Basic Stipend: contractual daily rate ×
   * credited attendance days (full day per PRESENT/SHORT_LEAVE/etc.).
   */
  payrollBasicStipend: number;
  fixedAllowances: number;
  fixedPackageDeductions: number;
  disciplineDeductions: number;
  extraAllowances: number;
  netStipend: number;
}

/**
 * Duty length in hours purely from a start/end window (no dutyTotalHours
 * shortcut) — used wherever the window itself was already resolved against
 * a specific date (e.g. an AttendanceLog's own snapshot), since there is no
 * historical dutyTotalHours to match it against, only the time pair.
 */
export function hoursFromDutyWindow(win: DutyWindow | null): number {
  if (!win) return 8;
  if (win.is24h) return 24;

  let minutes = win.endMin - win.startMin;
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
}

export function resolveDailyDutyHours(employee: {
  dutyTotalHours?: number | null;
  dutyStartTime?: string | null;
  dutyEndTime?: string | null;
  shift?: { startTime: string; endTime: string } | null;
}): number {
  if (employee.dutyTotalHours && employee.dutyTotalHours > 0) {
    return employee.dutyTotalHours;
  }

  const win = getDutyWindow({
    dutyStartTime: employee.dutyStartTime ?? employee.shift?.startTime,
    dutyEndTime: employee.dutyEndTime ?? employee.shift?.endTime,
  });
  return hoursFromDutyWindow(win);
}

export function computeHourlyRate(
  basicStipend: number,
  dailyDutyHours: number,
  daysInMonth: number,
): number {
  const monthlyWorkingHours = dailyDutyHours * daysInMonth;
  if (monthlyWorkingHours <= 0 || basicStipend <= 0) return 0;
  return Math.round((basicStipend / monthlyWorkingHours) * 100) / 100;
}

function pakistanMinutesOfDay(date: Date): number {
  const pk = new Date(date.getTime() + PK_OFFSET_MS);
  return pk.getUTCHours() * 60 + pk.getUTCMinutes();
}

/**
 * Minutes of a punch interval that fall inside the duty window.
 * Early / post-duty time is excluded so it is not paid twice with overtime.
 */
export function payableMinutesWithinDutyWindow(
  checkIn: Date,
  checkOut: Date,
  win: DutyWindow | null,
): { minutes: number; anomalous: boolean } {
  const session = workedMinutes(checkIn, checkOut, win);
  if (session.anomalous) return session;
  if (!win || win.is24h) return session;

  const inMin = pakistanMinutesOfDay(checkIn);
  const outMin = pakistanMinutesOfDay(checkOut);
  const sessionStart = inMin;
  let sessionEnd = outMin;
  if (sessionEnd < sessionStart) sessionEnd += 1440;

  let dutyStart = win.startMin;
  let dutyEnd = win.endMin;
  if (win.crossesMidnight) {
    // Session spanning midnight: duty end is next calendar day.
    if (sessionStart >= win.startMin) {
      dutyEnd = win.endMin + 1440;
    } else {
      // Punch after midnight for an overnight duty that started previous evening.
      dutyStart = win.startMin - 1440;
      dutyEnd = win.endMin;
    }
  } else if (dutyEnd <= dutyStart) {
    dutyEnd += 1440;
  }

  const overlapStart = Math.max(sessionStart, dutyStart);
  const overlapEnd = Math.min(sessionEnd, dutyEnd);
  const minutes = Math.max(0, Math.round(overlapEnd - overlapStart));
  return { minutes, anomalous: false };
}

export function leaveCreditMinutes(
  status: string,
  note: string | null | undefined,
  dailyDutyMinutes: number,
): number {
  if (status === 'ON_LEAVE') return dailyDutyMinutes;
  if (
    status === 'HALF_DAY' &&
    (note ?? '').toLowerCase().includes('short leave')
  ) {
    return Math.round(dailyDutyMinutes / 2);
  }
  return 0;
}

/** Exported so callers attributing individual unpaid-leave dates to a
 * specific stipend segment (see PayrollService.computeMonthlyUnpaidLeaveDates)
 * use the exact same date-key format as splitPaidUnpaidLeaveDays below —
 * a single source of truth, no format-drift risk between the two. */
export function dateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Default monthly paid-REGULAR-leave allowance applied when an employee has
 * no explicit Employee.monthlyAllowedLeaves override. Business policy: 2
 * paid leave days per calendar month for everyone unless HR has recorded an
 * explicit exception on the employee record.
 */
export const DEFAULT_MONTHLY_ALLOWED_LEAVES = 2;

/**
 * Split full ON_LEAVE days into paid vs unpaid using monthly allowance.
 * null/undefined allowance falls back to DEFAULT_MONTHLY_ALLOWED_LEAVES — an
 * explicit per-employee value (including 0) always overrides the default.
 * SHORT leave is not counted here (see leaveCreditMinutes).
 */
export function splitPaidUnpaidLeaveDays(input: {
  onLeaveDates: Date[];
  monthlyAllowedLeaves: number | null | undefined;
}): {
  leaveDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  paidLeaveDateKeys: Set<string>;
} {
  const uniqueSorted = [
    ...new Map(
      input.onLeaveDates.map((d) => [dateKey(d), d] as const),
    ).values(),
  ].sort((a, b) => a.getTime() - b.getTime());

  const leaveDays = uniqueSorted.length;
  const allowance =
    input.monthlyAllowedLeaves == null
      ? DEFAULT_MONTHLY_ALLOWED_LEAVES
      : Math.max(0, Math.floor(input.monthlyAllowedLeaves));

  const paid = uniqueSorted.slice(0, allowance);
  const unpaidLeaveDays = Math.max(0, leaveDays - allowance);
  return {
    leaveDays,
    paidLeaveDays: paid.length,
    unpaidLeaveDays,
    paidLeaveDateKeys: new Set(paid.map(dateKey)),
  };
}

/**
 * Payable extra reliever minutes = actual session duration minus whatever
 * portion of it overlaps the reliever's own paid duty window. Reuses
 * payableMinutesWithinDutyWindow (the same overlap math already proven for
 * the employee's own regular-attendance payable minutes) rather than a new
 * formula — its existing crossesMidnight handling already covers overnight
 * duty windows and overnight sessions correctly, and win.is24h already
 * makes it return the full session as "within duty", giving 0 payable extra
 * for 24-hour staff covering during their own duty period by construction.
 *
 * `employee.relieverOnly` and "no configured duty window at all" are the
 * only reliable existing signals for "this employee has no own paid duty" —
 * there is no day-of-week/rest-day concept anywhere in this codebase, so a
 * regular employee relieving on what would be their normal weekly off day
 * cannot be distinguished from a normal working day with current data.
 */
export function computeRelieverPayableMinutes(
  employee: {
    relieverOnly?: boolean;
    dutyStartTime?: string | null;
    dutyEndTime?: string | null;
  },
  session: { checkIn: Date; checkOut: Date; totalMinutes: number },
): number {
  if (employee.relieverOnly) return session.totalMinutes;

  const win = getDutyWindow(employee);
  if (!win) return session.totalMinutes;

  const overlap = payableMinutesWithinDutyWindow(
    session.checkIn,
    session.checkOut,
    win,
  );
  if (overlap.anomalous) return session.totalMinutes;

  return Math.max(0, session.totalMinutes - overlap.minutes);
}

export function unpaidLeaveDeductionAmount(
  unpaidLeaveDays: number,
  contractualBasic: number,
  daysInMonth: number,
): number {
  if (unpaidLeaveDays <= 0 || daysInMonth <= 0 || contractualBasic <= 0) {
    return 0;
  }
  return roundMoney((contractualBasic / daysInMonth) * unpaidLeaveDays);
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundHoursFromMinutes(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export function buildHourlyPayrollBreakdown(input: {
  contractualBasicStipend: number;
  dailyDutyHours: number;
  daysInMonth: number;
  workedMinutes: number;
  paidLeaveMinutes: number;
  policyCreditMinutes: number;
  creditedAttendanceDays?: number;
  fixedAllowances: number;
  fixedPackageDeductions: number;
  disciplineDeductions: number;
  extraAllowances: number;
  /** When set, Net uses this instead of hourlyBasicEarned (monthly payroll). */
  payrollBasicStipend?: number;
}): HourlyPayrollBreakdown {
  const scheduledHours = roundMoney(input.dailyDutyHours * input.daysInMonth);
  const hourlyRate = computeHourlyRate(
    input.contractualBasicStipend,
    input.dailyDutyHours,
    input.daysInMonth,
  );
  const payableMinutes =
    input.workedMinutes + input.paidLeaveMinutes + input.policyCreditMinutes;
  const payableHours = roundHoursFromMinutes(payableMinutes);
  const scheduledMinutes = input.daysInMonth * input.dailyDutyHours * 60;
  const hourlyBasicEarned =
    scheduledMinutes > 0
      ? roundMoney(
          (input.contractualBasicStipend * payableMinutes) / scheduledMinutes,
        )
      : 0;
  const payrollBasicStipend = roundMoney(
    Math.max(
      0,
      input.payrollBasicStipend != null
        ? input.payrollBasicStipend
        : hourlyBasicEarned,
    ),
  );
  const netStipend = roundMoney(
    Math.max(
      0,
      payrollBasicStipend +
        input.fixedAllowances +
        input.extraAllowances -
        input.fixedPackageDeductions -
        input.disciplineDeductions,
    ),
  );

  return {
    contractualBasicStipend: input.contractualBasicStipend,
    dailyDutyHours: input.dailyDutyHours,
    daysInMonth: input.daysInMonth,
    scheduledHours,
    hourlyRate,
    workedMinutes: input.workedMinutes,
    workedHours: roundHoursFromMinutes(input.workedMinutes),
    paidLeaveMinutes: input.paidLeaveMinutes,
    paidLeaveHours: roundHoursFromMinutes(input.paidLeaveMinutes),
    policyCreditMinutes: input.policyCreditMinutes,
    policyCreditHours: roundHoursFromMinutes(input.policyCreditMinutes),
    creditedAttendanceDays: Math.max(0, input.creditedAttendanceDays ?? 0),
    payableMinutes,
    payableHours,
    hourlyBasicEarned,
    payrollBasicStipend,
    fixedAllowances: input.fixedAllowances,
    fixedPackageDeductions: input.fixedPackageDeductions,
    disciplineDeductions: input.disciplineDeductions,
    extraAllowances: input.extraAllowances,
    netStipend,
  };
}
