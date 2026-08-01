/** Duty window helpers — Employee.dutyStartTime/dutyEndTime is source of truth. */

export const DUTY_FILTER_GRACE_MINUTES = 60;

export interface DutyWindow {
  startMin: number; // minutes since midnight, PKT
  endMin: number;
  crossesMidnight: boolean;
  is24h: boolean;
}

/** Parses "HH:mm" (24h) OR "hh:mm AM/PM". Throws on anything else. */
export function parseDutyTimeToMinutes(value: string): number {
  const v = value.trim();
  const ampm = v.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10) % 12;
    if (/pm/i.test(ampm[3])) h += 12;
    return h * 60 + parseInt(ampm[2], 10);
  }
  const h24 = v.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const h = parseInt(h24[1], 10);
    const m = parseInt(h24[2], 10);
    if (h > 23 || m > 59) throw new Error(`Invalid duty time: "${value}"`);
    return h * 60 + m;
  }
  throw new Error(`Unparseable duty time: "${value}"`);
}

/** Normalize any accepted duty string to canonical "HH:mm". */
export function normalizeDutyTimeToHhMm(value: string): string {
  const mins = parseDutyTimeToMinutes(value);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getDutyWindow(emp: {
  dutyStartTime?: string | null;
  dutyEndTime?: string | null;
}): DutyWindow | null {
  if (!emp.dutyStartTime || !emp.dutyEndTime) return null;
  const startMin = parseDutyTimeToMinutes(emp.dutyStartTime);
  const endMin = parseDutyTimeToMinutes(emp.dutyEndTime);
  const is24h = startMin === endMin;
  return {
    startMin,
    endMin,
    is24h,
    crossesMidnight: !is24h && endMin < startMin,
  };
}

/**
 * Is minutesOfDay (PKT) inside the duty window, with grace padding?
 * Known limitation: for a non-crossing window ending near midnight, grace
 * does not spill into the next day. Acceptable.
 */
export function isOnDutyAt(
  win: DutyWindow,
  minutesOfDay: number,
  graceMin = 0,
): boolean {
  if (win.is24h) return true;
  const s = win.startMin - graceMin;
  const e = win.endMin + graceMin;
  if (!win.crossesMidnight) {
    return minutesOfDay >= s && minutesOfDay <= e;
  }
  // Cross-midnight: on duty from (start - grace) through midnight, then until (end + grace).
  const startWithGrace = ((s % 1440) + 1440) % 1440;
  const endWithGrace = e % 1440;
  return minutesOfDay >= startWithGrace || minutesOfDay <= endWithGrace;
}

/** Minutes after duty start that are still counted as on time. */
export const LATE_GRACE_MINUTES = 15;

/**
 * A check-in earlier than this many minutes before duty start is credited as
 * overtime instead of treated as a plain early arrival. Arriving up to and
 * including this many minutes early is a normal check-in.
 */
export const EARLY_OVERTIME_THRESHOLD_MINUTES = 60;

/**
 * Signed minutes between a punch and duty start, resolved to the nearest
 * occurrence of that duty time. Positive means after duty start, negative
 * means before it.
 *
 * Without the wrap, an early punch on a night shift (19:30 against a 20:00
 * start) reads as ~23.5 hours *since* the previous day's start and produced
 * absurd late totals.
 */
export function signedMinutesFromDutyStart(
  minutesOfDay: number,
  dutyStartMin: number,
): number {
  let diff = minutesOfDay - dutyStartMin;
  if (diff > 720) diff -= 1440;
  if (diff <= -720) diff += 1440;
  return diff;
}

export interface CheckInAssessment {
  /** Minutes late beyond the grace period. 0 when on time or early. */
  lateMinutes: number;
  /** Minutes the punch landed before duty start. 0 when on time or late. */
  earlyMinutes: number;
  /**
   * Early arrival credited as overtime — the whole span from the punch to duty
   * start, counted only once the early arrival passes the threshold.
   */
  preDutyOvertimeMinutes: number;
}

export function assessCheckIn(
  minutesOfDay: number,
  dutyStartMin: number,
  graceMinutes = LATE_GRACE_MINUTES,
  earlyOvertimeThreshold = EARLY_OVERTIME_THRESHOLD_MINUTES,
): CheckInAssessment {
  const offset = signedMinutesFromDutyStart(minutesOfDay, dutyStartMin);

  if (offset >= 0) {
    const late = offset - graceMinutes;
    return {
      lateMinutes: late > 0 ? late : 0,
      earlyMinutes: 0,
      preDutyOvertimeMinutes: 0,
    };
  }

  const earlyMinutes = -offset;
  return {
    lateMinutes: 0,
    earlyMinutes,
    preDutyOvertimeMinutes:
      earlyMinutes > earlyOvertimeThreshold ? earlyMinutes : 0,
  };
}

/** Canonical display format: "08:00 AM" */
export function formatDuty12h(value: string): string {
  const mins = parseDutyTimeToMinutes(value);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatDutyWindow12h(emp: {
  dutyStartTime?: string | null;
  dutyEndTime?: string | null;
}): string {
  if (!emp.dutyStartTime || !emp.dutyEndTime) return 'Not assigned';
  try {
    return `${formatDuty12h(emp.dutyStartTime)} - ${formatDuty12h(emp.dutyEndTime)}`;
  } catch {
    return `${emp.dutyStartTime} - ${emp.dutyEndTime}`;
  }
}

/**
 * Duration between punches. Cross-midnight windows that were stamped on the
 * same calendar day get +1440. Anomalous rows (still negative or > 24h) → 0.
 */
export function workedMinutes(
  checkIn: Date,
  checkOut: Date,
  win: DutyWindow | null,
): { minutes: number; anomalous: boolean } {
  let diff = Math.round((checkOut.getTime() - checkIn.getTime()) / 60000);
  if (diff < 0 && win?.crossesMidnight) diff += 1440;
  if (diff < 0 || diff > 1440) return { minutes: 0, anomalous: true };
  return { minutes: diff, anomalous: false };
}

export function filterByDutyNow<
  T extends {
    dutyStartTime?: string | null;
    dutyEndTime?: string | null;
    relieverOnly?: boolean;
  },
>(employees: T[], dutyFilter: 'onDutyNow' | 'all', minutesOfDay: number): T[] {
  if (dutyFilter === 'all') return employees;
  return employees.filter((emp) => {
    if (emp.relieverOnly) return true;
    const win = getDutyWindow(emp);
    if (!win) return true;
    return isOnDutyAt(win, minutesOfDay, DUTY_FILTER_GRACE_MINUTES);
  });
}
