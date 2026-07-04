import { AttendanceStatus } from '@prisma/client';
import {
  parseTimeToMinutes,
  toPakistanDateOnly,
  toPakistanMinutesOfDay,
} from './attendance-late.util';

export function calculateOvertime(
  checkOutMinutes: number,
  shiftEndMinutes: number,
  isOvernight: boolean,
): number {
  if (isOvernight) {
    if (checkOutMinutes > shiftEndMinutes) {
      return checkOutMinutes - shiftEndMinutes;
    }
    return 0;
  }

  if (checkOutMinutes > shiftEndMinutes) {
    return checkOutMinutes - shiftEndMinutes;
  }

  return 0;
}

export function resolveShiftEndTime(employee: {
  dutyEndTime?: string | null;
  shift?: { endTime: string } | null;
}): string | null {
  return employee.dutyEndTime ?? employee.shift?.endTime ?? null;
}

export function resolveShiftStartTime(employee: {
  dutyStartTime?: string | null;
  shift?: { startTime: string } | null;
}): string | null {
  return employee.dutyStartTime ?? employee.shift?.startTime ?? null;
}

export function isOvernightShift(
  startTime: string | null,
  endTime: string | null,
): boolean {
  if (!startTime || !endTime) return false;
  return parseTimeToMinutes(endTime) < parseTimeToMinutes(startTime);
}

export function computeBiometricLateMinutes(
  checkIn: Date,
  employee: {
    dutyStartTime?: string | null;
    shift?: { startTime: string } | null;
  },
): number {
  const dutyStart = employee.dutyStartTime ?? employee.shift?.startTime ?? null;
  if (!dutyStart) {
    return 0;
  }

  const checkInMinutes = toPakistanMinutesOfDay(checkIn);
  const dutyStartMinutes = parseTimeToMinutes(dutyStart);
  const late = checkInMinutes - dutyStartMinutes - 15;
  return late > 0 ? late : 0;
}

export function determineBiometricCheckInStatus(
  lateMinutes: number,
  employee: { dutyStartTime?: string | null },
  sessionMinutes: number,
): AttendanceStatus {
  if (
    lateMinutes > 60 &&
    employee.dutyStartTime &&
    sessionMinutes >= 240
  ) {
    return AttendanceStatus.HALF_DAY;
  }

  if (lateMinutes > 0) {
    return AttendanceStatus.LATE;
  }

  return AttendanceStatus.PRESENT;
}

export function computeBiometricOvertimeMinutes(
  checkIn: Date,
  checkOut: Date,
  employee: {
    dutyEndTime?: string | null;
    dutyStartTime?: string | null;
    shift?: { startTime: string; endTime: string } | null;
  },
): number {
  const sessionMinutes = Math.round(
    (checkOut.getTime() - checkIn.getTime()) / 60000,
  );

  if (sessionMinutes < 30) {
    return 0;
  }

  const shiftEnd = resolveShiftEndTime(employee);
  const shiftStart = resolveShiftStartTime(employee);
  const checkOutMinutes = toPakistanMinutesOfDay(checkOut);
  const shiftEndMinutes = shiftEnd
    ? parseTimeToMinutes(shiftEnd)
    : 18 * 60;
  const overnight = isOvernightShift(shiftStart, shiftEnd);

  return calculateOvertime(checkOutMinutes, shiftEndMinutes, overnight);
}

export { toPakistanDateOnly };
