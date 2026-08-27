import { AttendanceStatus } from '@prisma/client';

export type AttendanceLogSummaryInput = {
  status: AttendanceStatus;
  overtimeMinutes: number;
  lateMinutes: number;
};

export type AttendanceMonthSummary = {
  totalDays: number;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  shortLeave: number;
  onLeave: number;
  uninformedAbsent: number;
  holiday: number;
  swapCovered: number;
  unmarked: number;
  overtimeMinutes: number;
  totalLateMinutes: number;
};

export function summarizeAttendanceLogs(
  logs: AttendanceLogSummaryInput[],
): AttendanceMonthSummary {
  const countByStatus = (status: AttendanceStatus) =>
    logs.filter((log) => log.status === status).length;

  return {
    totalDays: logs.length,
    present: countByStatus(AttendanceStatus.PRESENT),
    absent: countByStatus(AttendanceStatus.ABSENT),
    late: countByStatus(AttendanceStatus.LATE),
    halfDay: countByStatus(AttendanceStatus.HALF_DAY),
    shortLeave: countByStatus(AttendanceStatus.SHORT_LEAVE),
    onLeave: countByStatus(AttendanceStatus.ON_LEAVE),
    uninformedAbsent: countByStatus(AttendanceStatus.UNINFORMED_ABSENT),
    holiday: countByStatus(AttendanceStatus.HOLIDAY),
    swapCovered: countByStatus(AttendanceStatus.SWAP_COVERED),
    unmarked: countByStatus(AttendanceStatus.UNMARKED),
    overtimeMinutes: logs.reduce((sum, log) => sum + log.overtimeMinutes, 0),
    totalLateMinutes: logs.reduce((sum, log) => sum + log.lateMinutes, 0),
  };
}
