import { AttendanceStatus } from '@prisma/client';
import { resolveAttendanceDutyTimes } from '../../common/duty.util';
import { computeBiometricLateMinutes, is24HourShift, isOvernightShift } from './attendance-biometric.util';
import { computeShiftEndDateTime } from './shift-time.util';
export function classifyDutyCheckout(
  log: {date:Date;status:AttendanceStatus;checkIn:Date|null;lateMinutes?:number;dutyStartTimeSnapshot?:string|null;dutyEndTimeSnapshot?:string|null},
  employee: {dutyStartTime?:string|null;dutyEndTime?:string|null;dutyTotalHours?:number|null;shift?:{startTime:string;endTime:string;name?:string|null}|null},
  checkOut: Date,
) {
  if (log.status === AttendanceStatus.HOLIDAY) return { lateMinutes: 0 };
  if (!log.checkIn || is24HourShift(employee) ||
      !([AttendanceStatus.PRESENT,AttendanceStatus.LATE,AttendanceStatus.HALF_DAY] as AttendanceStatus[]).includes(log.status)) return {};
  const duty=resolveAttendanceDutyTimes(log,employee);
  if(!duty.dutyStartTime || !duty.dutyEndTime) return {};
  const end=computeShiftEndDateTime(log.date,duty.dutyEndTime,isOvernightShift(duty.dutyStartTime,duty.dutyEndTime));
  const earlyMinutes=Math.max(0,Math.round((end.getTime()-checkOut.getTime())/60000));
  const checkInLate=computeBiometricLateMinutes(log.checkIn,{...employee,...duty});
  const lateMinutes=checkInLate+(earlyMinutes>15?earlyMinutes:0);
  return {lateMinutes,status:lateMinutes>120?AttendanceStatus.HALF_DAY:lateMinutes>0?AttendanceStatus.LATE:AttendanceStatus.PRESENT};
}
