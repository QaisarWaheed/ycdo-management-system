import { AttendanceStatus } from '@prisma/client';
import {
  EARLY_OUT_GRACE_MINUTES,
  resolveAttendanceDutyTimes,
} from '../../common/duty.util';
import {
  computeBiometricLateMinutes,
  is24HourShift,
  isOvernightShift,
} from './attendance-biometric.util';
import { computeShiftEndDateTime } from './shift-time.util';

/**
 * Classify a REGULAR session at check-out. Lateness comes from check-in only;
 * leaving early is recorded separately as earlyOutMinutes (beyond the 15-min
 * grace) and never turns the day LATE or HALF_DAY — it has its own
 * early-checkout discipline track.
 */
export function classifyDutyCheckout(
  log: {
    date: Date;
    status: AttendanceStatus;
    checkIn: Date | null;
    lateMinutes?: number;
    dutyStartTimeSnapshot?: string | null;
    dutyEndTimeSnapshot?: string | null;
  },
  employee: {
    dutyStartTime?: string | null;
    dutyEndTime?: string | null;
    dutyTotalHours?: number | null;
    shift?: { startTime: string; endTime: string; name?: string | null } | null;
  },
  checkOut: Date,
): {
  lateMinutes?: number;
  earlyOutMinutes: number;
  status?: AttendanceStatus;
} {
  if (log.status === AttendanceStatus.HOLIDAY)
    return { lateMinutes: 0, earlyOutMinutes: 0 };
  if (
    !log.checkIn ||
    is24HourShift(employee) ||
    !(
      [
        AttendanceStatus.PRESENT,
        AttendanceStatus.LATE,
        AttendanceStatus.HALF_DAY,
      ] as AttendanceStatus[]
    ).includes(log.status)
  )
    return { earlyOutMinutes: 0 };
  const duty = resolveAttendanceDutyTimes(log, employee);
  if (!duty.dutyStartTime || !duty.dutyEndTime) return { earlyOutMinutes: 0 };
  const end = computeShiftEndDateTime(
    log.date,
    duty.dutyEndTime,
    isOvernightShift(duty.dutyStartTime, duty.dutyEndTime),
  );
  const earlyMinutes = Math.max(
    0,
    Math.round((end.getTime() - checkOut.getTime()) / 60000),
  );
  const lateMinutes = computeBiometricLateMinutes(log.checkIn, {
    ...employee,
    ...duty,
  });
  const earlyOutMinutes =
    earlyMinutes > EARLY_OUT_GRACE_MINUTES ? earlyMinutes : 0;
  return {
    lateMinutes,
    earlyOutMinutes,
    status:
      lateMinutes > 120
        ? AttendanceStatus.HALF_DAY
        : lateMinutes > 0
          ? AttendanceStatus.LATE
          : AttendanceStatus.PRESENT,
  };
}
