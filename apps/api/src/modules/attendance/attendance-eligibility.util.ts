import { BadRequestException } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';

/** Working staff who may receive attendance from any source. */
export const ATTENDANCE_ELIGIBLE_STATUSES: EmployeeStatus[] = [
  EmployeeStatus.ACTIVE,
  EmployeeStatus.TRAINEE,
];

export const ATTENDANCE_ELIGIBLE_STATUS_WHERE = {
  status: { in: ATTENDANCE_ELIGIBLE_STATUSES },
} as const;

export function isEmployeeEligibleForAttendance(
  status: EmployeeStatus,
): boolean {
  return ATTENDANCE_ELIGIBLE_STATUSES.includes(status);
}

export function attendanceLockMessage(status: EmployeeStatus): string {
  if (status === EmployeeStatus.PENDING_APPROVAL) {
    return 'Attendance is locked until this employee is approved and becomes Active.';
  }
  if (status === EmployeeStatus.APPOINTED) {
    return 'Attendance is locked until this employee becomes Active.';
  }
  return 'Employee is not eligible for attendance';
}

export function assertEmployeeEligibleForAttendance(employee: {
  status: EmployeeStatus;
}): void {
  if (!isEmployeeEligibleForAttendance(employee.status)) {
    throw new BadRequestException(attendanceLockMessage(employee.status));
  }
}
