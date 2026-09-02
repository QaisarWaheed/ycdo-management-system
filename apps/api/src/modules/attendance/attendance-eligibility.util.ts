import { BadRequestException } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import { toPakistanDateOnly } from './attendance-late.util';
import {
  isExitEmployeeStatus,
  isOperationalAttendanceDate,
} from '../employees/status-effective.util';

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

export type EmployeeAttendanceContext = {
  status: EmployeeStatus;
  statusEffectiveFrom?: Date | null;
  joiningDate?: Date | null;
};

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

/** Statuses HR may correct on an existing attendance row. */
const HR_ATTENDANCE_CORRECTION_STATUSES: ReadonlySet<EmployeeStatus> = new Set([
  EmployeeStatus.ACTIVE,
  EmployeeStatus.TRAINEE,
  EmployeeStatus.ON_LEAVE,
  EmployeeStatus.APPOINTED,
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

function assertOperationalForDate(
  context: EmployeeAttendanceContext,
  date: Date = new Date(),
): void {
  if (!isOperationalAttendanceDate(date, context)) {
    throw new BadRequestException(
      'Employee is not eligible for attendance on this date',
    );
  }
}

function isNoticePeriodExit(context: EmployeeAttendanceContext, date: Date): boolean {
  return (
    isExitEmployeeStatus(context.status) &&
    !!context.statusEffectiveFrom &&
    toPakistanDateOnly(date).getTime() <
      toPakistanDateOnly(context.statusEffectiveFrom).getTime()
  );
}

export function assertEmployeeEligibleForBiometricAttendance(
  status: EmployeeStatus,
  context?: EmployeeAttendanceContext,
  date: Date = new Date(),
): void {
  rejectPendingApproval(status);
  if (context) {
    assertOperationalForDate(context, date);
  }
  if (BIOMETRIC_ATTENDANCE_STATUSES.has(status)) return;
  if (context && isNoticePeriodExit(context, date)) return;
  throw new BadRequestException('Employee is not active');
}

export function assertEmployeeEligibleForManualAttendance(
  status: EmployeeStatus,
  context?: EmployeeAttendanceContext,
  date: Date = new Date(),
): void {
  rejectPendingApproval(status);
  if (context) {
    assertOperationalForDate(context, date);
  }
  if (MANUAL_ATTENDANCE_STATUSES.has(status)) return;
  if (context && isNoticePeriodExit(context, date)) return;
  throw new BadRequestException('Employee is not active');
}

export function assertEmployeeEligibleForRelieverAttendance(
  status: EmployeeStatus,
  context?: EmployeeAttendanceContext,
  date: Date = new Date(),
): void {
  rejectPendingApproval(status);
  if (context) {
    assertOperationalForDate(context, date);
  }
  if (RELIEVER_ATTENDANCE_STATUSES.has(status)) return;
  if (context && isNoticePeriodExit(context, date)) return;
  throw new BadRequestException('Reliever employee is not active');
}

export function assertEmployeeEligibleForAttendanceRecord(
  status: EmployeeStatus,
  context?: EmployeeAttendanceContext,
  date: Date = new Date(),
): void {
  rejectPendingApproval(status);
  if (context) {
    assertOperationalForDate(context, date);
  }
  if (status === EmployeeStatus.SUSPENDED) {
    throw new BadRequestException(
      'Attendance is locked while the employee is suspended.',
    );
  }
  if (HR_ATTENDANCE_CORRECTION_STATUSES.has(status)) return;
  if (context && isNoticePeriodExit(context, date)) return;
  throw new BadRequestException('Employee is not eligible for attendance');
}

export function assertEmployeeEligibleForAttendance(employee: {
  status: EmployeeStatus;
  statusEffectiveFrom?: Date | null;
  joiningDate?: Date | null;
}): void {
  rejectPendingApproval(employee.status);
  if (employee.status === EmployeeStatus.APPOINTED) {
    throw new BadRequestException(
      attendanceLockMessage(EmployeeStatus.APPOINTED),
    );
  }

  const context: EmployeeAttendanceContext = {
    status: employee.status,
    statusEffectiveFrom: employee.statusEffectiveFrom,
    joiningDate: employee.joiningDate,
  };
  const today = new Date();

  if (isNoticePeriodExit(context, today)) {
    return;
  }

  if (!isEmployeeEligibleForAttendance(employee.status)) {
    throw new BadRequestException(attendanceLockMessage(employee.status));
  }

  if (!isOperationalAttendanceDate(today, context)) {
    throw new BadRequestException(
      'Employee is not eligible for attendance on this date',
    );
  }
}
