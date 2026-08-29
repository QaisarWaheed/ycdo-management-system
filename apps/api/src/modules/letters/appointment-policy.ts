import { BadRequestException } from '@nestjs/common';
import { DEFAULT_MONTHLY_ALLOWED_LEAVES } from '../payroll/payroll-hours.util';

export const APPOINTMENT_DUTY_HOURS_REQUIRED_MESSAGE =
  'Duty hours are required to issue the Appointment Letter and to calculate Short Leave duration. Record duty hours on the employee profile first.';

export function resolveAppointmentDutyTotalHours(input: {
  employeeDutyTotalHours?: number | string | null;
  extraFields?: Record<string, unknown>;
}): number {
  const candidates = [
    input.employeeDutyTotalHours,
    input.extraFields?.dutyTotalHours,
    input.extraFields?.hoursPerDay,
  ];
  for (const raw of candidates) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      continue;
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  throw new BadRequestException(APPOINTMENT_DUTY_HOURS_REQUIRED_MESSAGE);
}

export function shortLeaveHoursFromDutyTotalHours(dutyTotalHours: number): string {
  const half = dutyTotalHours / 2;
  if (Number.isInteger(half)) return String(half);
  return String(Number(half.toFixed(2)));
}

/**
 * Uses Employee.monthlyAllowedLeaves when set (including 0).
 * null/undefined uses DEFAULT_MONTHLY_ALLOWED_LEAVES (2) — the same payroll
 * paid-leave policy already applied when HR has not recorded an override.
 */
export function resolveAppointmentMonthlyAllowedLeaves(input: {
  employeeMonthlyAllowedLeaves?: number | null;
  extraFields?: Record<string, unknown>;
}): number {
  const extra = input.extraFields?.monthlyAllowedLeaves;
  if (extra !== undefined && extra !== null && String(extra).trim() !== '') {
    const n = Number(extra);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  if (
    input.employeeMonthlyAllowedLeaves !== undefined &&
    input.employeeMonthlyAllowedLeaves !== null
  ) {
    return Math.max(0, Math.floor(input.employeeMonthlyAllowedLeaves));
  }
  return DEFAULT_MONTHLY_ALLOWED_LEAVES;
}
