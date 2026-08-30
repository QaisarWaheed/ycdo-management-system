/** Working staff who may receive biometric / auto attendance. */
export const ATTENDANCE_ELIGIBLE_STATUSES = ['ACTIVE', 'TRAINEE'] as const

/** Statuses HR may correct on the Daily Log / profile attendance table. */
const HR_ATTENDANCE_CORRECTION_STATUSES = [
  'ACTIVE',
  'TRAINEE',
  'ON_LEAVE',
  'APPOINTED',
] as const

export function isEmployeeEligibleForAttendance(
  status?: string | null,
): boolean {
  return status === 'ACTIVE' || status === 'TRAINEE'
}

export function canHrCorrectAttendance(status?: string | null): boolean {
  return (
    !!status &&
    (HR_ATTENDANCE_CORRECTION_STATUSES as readonly string[]).includes(status)
  )
}

export function attendanceLockMessage(status?: string | null): string {
  if (status === 'PENDING_APPROVAL') {
    return 'Attendance is locked until this employee is approved and becomes Active.'
  }
  if (status === 'APPOINTED') {
    return 'Attendance is locked until this employee becomes Active.'
  }
  if (status === 'SUSPENDED') {
    return 'Attendance is locked while the employee is suspended.'
  }
  return 'Attendance is locked for this employee status.'
}
