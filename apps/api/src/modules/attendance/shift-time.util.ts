import { assessCheckIn, LATE_GRACE_MINUTES } from '../../common/duty.util';
import {
  parseTimeToMinutes,
  toPakistanDateOnly,
  toPakistanMinutesOfDay,
} from './attendance-late.util';

/** Night / evening shifts start at or after 18:00 */
const OVERNIGHT_SHIFT_START = 18 * 60;

export function minutesSinceShiftStart(
  currentMinutes: number,
  shiftStartMinutes: number,
): number {
  if (shiftStartMinutes >= OVERNIGHT_SHIFT_START) {
    if (currentMinutes >= shiftStartMinutes) {
      return currentMinutes - shiftStartMinutes;
    }
    return 1440 - shiftStartMinutes + currentMinutes;
  }
  return currentMinutes - shiftStartMinutes;
}

/**
 * Attendance log date for a shift relative to current Pakistan time.
 * e.g. 01:00 AM with shift start 20:00 → yesterday's date.
 */
export function getShiftAttendanceDate(
  now: Date,
  shiftStartTime: string,
): Date {
  const currentMinutes = toPakistanMinutesOfDay(now);
  const shiftStartMinutes = parseTimeToMinutes(shiftStartTime);
  const pkToday = toPakistanDateOnly(now);

  if (
    shiftStartMinutes >= OVERNIGHT_SHIFT_START &&
    currentMinutes < shiftStartMinutes
  ) {
    const yesterday = new Date(pkToday);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return yesterday;
  }

  return pkToday;
}

export function statusFromLateMinutes(
  lateMinutes: number,
): 'PRESENT' | 'LATE' | 'HALF_DAY' {
  if (lateMinutes > 60) return 'HALF_DAY';
  if (lateMinutes > 0) return 'LATE';
  return 'PRESENT';
}

export function calculateLateMinutesFromCheckIn(
  checkIn: Date,
  dutyStartTime: string,
  graceMinutes = LATE_GRACE_MINUTES,
): number {
  return assessCheckIn(
    toPakistanMinutesOfDay(checkIn),
    parseTimeToMinutes(dutyStartTime),
    graceMinutes,
  ).lateMinutes;
}

export const ATTENDANCE_MARKING_GRACE_MINUTES = 15;
export const DEFAULT_DUTY_START = '08:00';

export function isWithinAttendanceMarkingGrace(
  now: Date,
  dutyStartTime: string | null | undefined,
  graceMinutes = ATTENDANCE_MARKING_GRACE_MINUTES,
): boolean {
  const dutyStart = dutyStartTime?.trim() || DEFAULT_DUTY_START;
  const nowMinutes = toPakistanMinutesOfDay(now);
  const shiftStartMinutes = parseTimeToMinutes(dutyStart);
  const minutesSince = minutesSinceShiftStart(nowMinutes, shiftStartMinutes);
  return minutesSince >= 0 && minutesSince <= graceMinutes;
}

export function attendanceGraceMinutesRemaining(
  now: Date,
  dutyStartTime: string | null | undefined,
  graceMinutes = ATTENDANCE_MARKING_GRACE_MINUTES,
): number {
  const dutyStart = dutyStartTime?.trim() || DEFAULT_DUTY_START;
  const nowMinutes = toPakistanMinutesOfDay(now);
  const shiftStartMinutes = parseTimeToMinutes(dutyStart);
  const minutesSince = minutesSinceShiftStart(nowMinutes, shiftStartMinutes);
  if (minutesSince < 0) return graceMinutes;
  return Math.max(0, graceMinutes - minutesSince);
}

/**
 * Absolute shift-end timestamp for one specific attendance day. The row's
 * `date` is already attributed to the shift's start day (getShiftAttendanceDate,
 * assigned at check-in time), so the exact end instant can be computed
 * directly (date + end clock time, +1 day if the shift crosses midnight)
 * instead of a wraparound "minutes since" comparison — there is no ambiguity
 * about which calendar occurrence of the end time is meant once the specific
 * date is already known.
 */
export function computeShiftEndDateTime(
  attendanceDate: Date,
  dutyEndTime: string,
  crossesMidnight: boolean,
): Date {
  const dateStr = attendanceDate.toISOString().slice(0, 10);
  const endMinutes = parseTimeToMinutes(dutyEndTime);
  const end = new Date(`${dateStr}T00:00:00+05:00`);
  end.setUTCMinutes(
    end.getUTCMinutes() + endMinutes + (crossesMidnight ? 1440 : 0),
  );
  return end;
}

export { toPakistanDateOnly, toPakistanMinutesOfDay, parseTimeToMinutes };
