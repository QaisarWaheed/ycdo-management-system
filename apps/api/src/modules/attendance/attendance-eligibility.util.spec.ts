import { BadRequestException } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import {
  assertEmployeeEligibleForAttendanceRecord,
  assertEmployeeEligibleForBiometricAttendance,
  assertEmployeeEligibleForManualAttendance,
  ATTENDANCE_PENDING_APPROVAL_MESSAGE,
} from './attendance-eligibility.util';

describe('attendance-eligibility.util', () => {
  it('rejects PENDING_APPROVAL for biometric attendance', () => {
    expect(() =>
      assertEmployeeEligibleForBiometricAttendance(
        EmployeeStatus.PENDING_APPROVAL,
      ),
    ).toThrow(new BadRequestException(ATTENDANCE_PENDING_APPROVAL_MESSAGE));
  });

  it('rejects PENDING_APPROVAL for manual attendance', () => {
    expect(() =>
      assertEmployeeEligibleForManualAttendance(
        EmployeeStatus.PENDING_APPROVAL,
      ),
    ).toThrow(new BadRequestException(ATTENDANCE_PENDING_APPROVAL_MESSAGE));
  });

  it('allows ACTIVE employees for biometric attendance', () => {
    expect(() =>
      assertEmployeeEligibleForBiometricAttendance(EmployeeStatus.ACTIVE),
    ).not.toThrow();
  });

  it('allows APPOINTED employees for manual attendance', () => {
    expect(() =>
      assertEmployeeEligibleForManualAttendance(EmployeeStatus.APPOINTED),
    ).not.toThrow();
  });

  it('rejects PENDING_APPROVAL for attendance record writes', () => {
    expect(() =>
      assertEmployeeEligibleForAttendanceRecord(
        EmployeeStatus.PENDING_APPROVAL,
      ),
    ).toThrow(new BadRequestException(ATTENDANCE_PENDING_APPROVAL_MESSAGE));
  });
});
