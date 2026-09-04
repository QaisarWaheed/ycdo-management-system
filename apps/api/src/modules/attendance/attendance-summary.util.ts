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

/** Counts finance uses on Monthly Payroll (same status buckets as the profile cards). */
export type PayrollAttendanceReport = {
  present: number;
  absent: number;
  onLeave: number;
  late: number;
  overtimeHours: number;
  extraWorkingDays: number;
};

export function toPayrollAttendanceReport(
  summary: AttendanceMonthSummary,
  extraWorkingDays = 0,
): PayrollAttendanceReport {
  return {
    present: summary.present + summary.swapCovered,
    absent: summary.absent + summary.uninformedAbsent,
    onLeave: summary.onLeave,
    late: summary.late,
    overtimeHours: Math.round((summary.overtimeMinutes / 60) * 100) / 100,
    extraWorkingDays,
  };
}

export const EMPTY_PAYROLL_ATTENDANCE_REPORT: PayrollAttendanceReport = {
  present: 0,
  absent: 0,
  onLeave: 0,
  late: 0,
  overtimeHours: 0,
  extraWorkingDays: 0,
};
