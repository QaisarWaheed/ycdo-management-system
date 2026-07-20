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

/**
 * 24-hour duty: check-in only (PRESENT / ABSENT). No late, half-day,
 * uninformed-absent, or checkout.
 */
export function is24HourShift(employee: {
  dutyStartTime?: string | null;
  dutyEndTime?: string | null;
  dutyTotalHours?: number | null;
  shift?: { name?: string | null; startTime: string; endTime: string } | null;
}): boolean {
  if (employee.dutyTotalHours != null && employee.dutyTotalHours >= 20) {
    return true;
  }

  if (employee.shift?.name?.toLowerCase().includes('24')) {
    return true;
  }

  const start = employee.dutyStartTime ?? employee.shift?.startTime ?? null;
  const end = employee.dutyEndTime ?? employee.shift?.endTime ?? null;
  if (!start || !end) return false;

  if (start === end) return true;

  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  let duration = endMin - startMin;
  if (duration <= 0) {
    duration += 24 * 60;
  }
  return duration >= 20 * 60;
}

export function is24HourShiftRecord(shift: {
  name?: string | null;
  startTime: string;
  endTime: string;
}): boolean {
  return is24HourShift({ shift });
}

export function computeBiometricLateMinutes(
  checkIn: Date,
  employee: {
    dutyStartTime?: string | null;
    dutyEndTime?: string | null;
    dutyTotalHours?: number | null;
    shift?: { name?: string | null; startTime: string; endTime?: string } | null;
  },
): number {
  if (
    is24HourShift({
      dutyStartTime: employee.dutyStartTime,
      dutyEndTime: employee.dutyEndTime,
      dutyTotalHours: employee.dutyTotalHours,
      shift: employee.shift
        ? {
            name: employee.shift.name,
            startTime: employee.shift.startTime,
            endTime: employee.shift.endTime ?? employee.shift.startTime,
          }
        : null,
    })
  ) {
    return 0;
  }

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
  // Callers must pass lateMinutes=0 for 24-hour staff.
  if (lateMinutes <= 0) {
    return AttendanceStatus.PRESENT;
  }

  if (
    lateMinutes > 60 &&
    employee.dutyStartTime &&
    sessionMinutes >= 240
  ) {
    return AttendanceStatus.HALF_DAY;
  }

  return AttendanceStatus.LATE;
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
