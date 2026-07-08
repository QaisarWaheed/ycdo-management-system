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
  graceMinutes = 15,
): number {
  const checkInMinutes = toPakistanMinutesOfDay(checkIn);
  const dutyStart = parseTimeToMinutes(dutyStartTime);
  const late = minutesSinceShiftStart(checkInMinutes, dutyStart) - graceMinutes;
  return late > 0 ? late : 0;
}

export { toPakistanDateOnly, toPakistanMinutesOfDay, parseTimeToMinutes };
