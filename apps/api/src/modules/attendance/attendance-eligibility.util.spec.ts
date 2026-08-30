import { BadRequestException } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import {
  assertEmployeeEligibleForAttendance,
  assertEmployeeEligibleForAttendanceRecord,
  assertEmployeeEligibleForBiometricAttendance,
  assertEmployeeEligibleForManualAttendance,
  ATTENDANCE_PENDING_APPROVAL_MESSAGE,
  isEmployeeEligibleForAttendance,
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

  it('allows HR to correct ACTIVE, TRAINEE, ON_LEAVE, and APPOINTED records', () => {
    expect(() =>
      assertEmployeeEligibleForAttendanceRecord(EmployeeStatus.ACTIVE),
    ).not.toThrow();
    expect(() =>
      assertEmployeeEligibleForAttendanceRecord(EmployeeStatus.TRAINEE),
    ).not.toThrow();
    expect(() =>
      assertEmployeeEligibleForAttendanceRecord(EmployeeStatus.ON_LEAVE),
    ).not.toThrow();
    expect(() =>
      assertEmployeeEligibleForAttendanceRecord(EmployeeStatus.APPOINTED),
    ).not.toThrow();
  });

  it('rejects SUSPENDED attendance record writes', () => {
    expect(() =>
      assertEmployeeEligibleForAttendanceRecord(EmployeeStatus.SUSPENDED),
    ).toThrow(/suspended/);
  });

  it('allows ACTIVE and TRAINEE only for working-staff filters', () => {
    expect(isEmployeeEligibleForAttendance(EmployeeStatus.ACTIVE)).toBe(true);
    expect(isEmployeeEligibleForAttendance(EmployeeStatus.TRAINEE)).toBe(true);
    expect(isEmployeeEligibleForAttendance(EmployeeStatus.APPOINTED)).toBe(
      false,
    );
    expect(
      isEmployeeEligibleForAttendance(EmployeeStatus.PENDING_APPROVAL),
    ).toBe(false);
    expect(isEmployeeEligibleForAttendance(EmployeeStatus.SUSPENDED)).toBe(
      false,
    );
    expect(isEmployeeEligibleForAttendance(EmployeeStatus.ON_REST)).toBe(false);
    expect(isEmployeeEligibleForAttendance(EmployeeStatus.TERMINATED)).toBe(
      false,
    );
    expect(isEmployeeEligibleForAttendance(EmployeeStatus.RESIGNED)).toBe(false);
    expect(isEmployeeEligibleForAttendance(EmployeeStatus.DISMISSED)).toBe(
      false,
    );
    expect(isEmployeeEligibleForAttendance(EmployeeStatus.ON_LEAVE)).toBe(false);
  });

  it('throws a pending-approval lock message', () => {
    expect(() =>
      assertEmployeeEligibleForAttendance({
        status: EmployeeStatus.PENDING_APPROVAL,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertEmployeeEligibleForAttendance({
        status: EmployeeStatus.PENDING_APPROVAL,
      }),
    ).toThrow(/locked until this employee is approved/);
  });

  it('throws an appointed lock message', () => {
    expect(() =>
      assertEmployeeEligibleForAttendance({
        status: EmployeeStatus.APPOINTED,
      }),
    ).toThrow(/becomes Active/);
  });
});
