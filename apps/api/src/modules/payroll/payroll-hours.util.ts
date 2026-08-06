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
  payableMinutes: number;
  payableHours: number;
  hourlyBasicEarned: number;
  fixedAllowances: number;
  fixedPackageDeductions: number;
  disciplineDeductions: number;
  extraAllowances: number;
  netStipend: number;
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
  if (!win) return 8;
  if (win.is24h) return 24;

  let minutes = win.endMin - win.startMin;
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
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

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Split full ON_LEAVE days into paid vs unpaid using monthly allowance.
 * null/undefined allowance = all paid (legacy). SHORT leave is not counted here.
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
  if (input.monthlyAllowedLeaves == null) {
    return {
      leaveDays,
      paidLeaveDays: leaveDays,
      unpaidLeaveDays: 0,
      paidLeaveDateKeys: new Set(uniqueSorted.map(dateKey)),
    };
  }

  const allowance = Math.max(0, Math.floor(input.monthlyAllowedLeaves));
  const paid = uniqueSorted.slice(0, allowance);
  const unpaidLeaveDays = Math.max(0, leaveDays - allowance);
  return {
    leaveDays,
    paidLeaveDays: paid.length,
    unpaidLeaveDays,
    paidLeaveDateKeys: new Set(paid.map(dateKey)),
  };
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
  fixedAllowances: number;
  fixedPackageDeductions: number;
  disciplineDeductions: number;
  extraAllowances: number;
}): HourlyPayrollBreakdown {
  const scheduledHours = roundMoney(input.dailyDutyHours * input.daysInMonth);
  const hourlyRate = computeHourlyRate(
    input.contractualBasicStipend,
    input.dailyDutyHours,
    input.daysInMonth,
  );
  const payableMinutes = input.workedMinutes + input.paidLeaveMinutes;
  const payableHours = roundHoursFromMinutes(payableMinutes);
  const hourlyBasicEarned = roundMoney(payableHours * hourlyRate);
  const netStipend = roundMoney(
    hourlyBasicEarned +
      input.fixedAllowances +
      input.extraAllowances -
      input.fixedPackageDeductions -
      input.disciplineDeductions,
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
    payableMinutes,
    payableHours,
    hourlyBasicEarned,
    fixedAllowances: input.fixedAllowances,
    fixedPackageDeductions: input.fixedPackageDeductions,
    disciplineDeductions: input.disciplineDeductions,
    extraAllowances: input.extraAllowances,
    netStipend,
  };
}
