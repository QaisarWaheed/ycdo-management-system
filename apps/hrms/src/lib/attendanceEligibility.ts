/** Matches API ATTENDANCE_ELIGIBLE_STATUSES — only these may receive attendance writes. */
export const ATTENDANCE_ELIGIBLE_STATUSES = ['ACTIVE', 'TRAINEE'] as const

export function isEmployeeEligibleForAttendance(
  status?: string | null,
): boolean {
  return status === 'ACTIVE' || status === 'TRAINEE'
}

export function attendanceLockMessage(status?: string | null): string {
  if (status === 'PENDING_APPROVAL') {
    return 'Attendance is locked until this employee is approved and becomes Active.'
  }
  if (status === 'APPOINTED') {
    return 'Attendance is locked until this employee becomes Active.'
  }
  return 'Attendance is locked for this employee status.'
}
