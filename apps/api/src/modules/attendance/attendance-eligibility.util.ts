import { BadRequestException } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';

export const ATTENDANCE_PENDING_APPROVAL_MESSAGE =
  'Attendance cannot be marked while the employee is pending executive onboarding approval.';

/** Working staff used by schedulers and list filters. */
export const ATTENDANCE_ELIGIBLE_STATUSES: EmployeeStatus[] = [
  EmployeeStatus.ACTIVE,
  EmployeeStatus.TRAINEE,
];

export const ATTENDANCE_ELIGIBLE_STATUS_WHERE = {
  status: { in: ATTENDANCE_ELIGIBLE_STATUSES },
} as const;

const BIOMETRIC_ATTENDANCE_STATUSES: ReadonlySet<EmployeeStatus> = new Set([
  EmployeeStatus.ACTIVE,
  EmployeeStatus.TRAINEE,
]);

const MANUAL_ATTENDANCE_STATUSES: ReadonlySet<EmployeeStatus> = new Set([
  EmployeeStatus.ACTIVE,
  EmployeeStatus.APPOINTED,
]);

const RELIEVER_ATTENDANCE_STATUSES: ReadonlySet<EmployeeStatus> = new Set([
  EmployeeStatus.ACTIVE,
  EmployeeStatus.APPOINTED,
  EmployeeStatus.TRAINEE,
]);

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

function rejectPendingApproval(status: EmployeeStatus): void {
  if (status === EmployeeStatus.PENDING_APPROVAL) {
    throw new BadRequestException(ATTENDANCE_PENDING_APPROVAL_MESSAGE);
  }
}

export function assertEmployeeEligibleForBiometricAttendance(
  status: EmployeeStatus,
): void {
  rejectPendingApproval(status);
  if (!BIOMETRIC_ATTENDANCE_STATUSES.has(status)) {
    throw new BadRequestException('Employee is not active');
  }
}

export function assertEmployeeEligibleForManualAttendance(
  status: EmployeeStatus,
): void {
  rejectPendingApproval(status);
  if (!MANUAL_ATTENDANCE_STATUSES.has(status)) {
    throw new BadRequestException('Employee is not active');
  }
}

export function assertEmployeeEligibleForRelieverAttendance(
  status: EmployeeStatus,
): void {
  rejectPendingApproval(status);
  if (!RELIEVER_ATTENDANCE_STATUSES.has(status)) {
    throw new BadRequestException('Reliever employee is not active');
  }
}

export function assertEmployeeEligibleForAttendanceRecord(
  status: EmployeeStatus,
): void {
  rejectPendingApproval(status);
}

export function assertEmployeeEligibleForAttendance(employee: {
  status: EmployeeStatus;
}): void {
  if (!isEmployeeEligibleForAttendance(employee.status)) {
    throw new BadRequestException(attendanceLockMessage(employee.status));
  }
}
