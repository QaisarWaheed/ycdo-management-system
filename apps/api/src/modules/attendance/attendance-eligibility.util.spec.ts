import { BadRequestException } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import {
  assertEmployeeEligibleForAttendance,
  isEmployeeEligibleForAttendance,
} from './attendance-eligibility.util';

describe('attendance eligibility', () => {
  it('allows ACTIVE and TRAINEE only', () => {
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
