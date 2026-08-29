import { BadRequestException } from '@nestjs/common';
import { isInvalidAppointmentAssignment } from './appointment-families';
import { APPOINTMENT_INVALID_ASSIGNMENT_MESSAGE } from './appointment-families';

export function assertAppointmentSnapshotReady(input: {
  fullName?: string | null;
  departmentName?: string | null;
  designation?: string | null;
  branchName?: string | null;
  stipendAmount?: string | null;
  dutyTotalHours?: string | number | null;
  scheduleFrom?: string | null;
  scheduleTo?: string | null;
}): void {
  if (
    isInvalidAppointmentAssignment(input.departmentName, input.designation)
  ) {
    throw new BadRequestException(APPOINTMENT_INVALID_ASSIGNMENT_MESSAGE);
  }

  const missing: string[] = [];
  if (!String(input.fullName ?? '').trim()) missing.push('employee name');
  if (!String(input.departmentName ?? '').trim()) missing.push('department');
  if (!String(input.designation ?? '').trim()) missing.push('designation');
  if (!String(input.branchName ?? '').trim()) missing.push('branch');
  if (!String(input.stipendAmount ?? '').trim()) missing.push('stipend amount');
  if (
    input.dutyTotalHours === undefined ||
    input.dutyTotalHours === null ||
    String(input.dutyTotalHours).trim() === ''
  ) {
    missing.push('duty hours');
  }
  if (!String(input.scheduleFrom ?? '').trim() || !String(input.scheduleTo ?? '').trim()) {
    missing.push('duty / shift timing');
  }
  if (missing.length) {
    throw new BadRequestException(
      `Cannot preview or generate the Appointment Letter — missing: ${missing.join(', ')}.`,
    );
  }
}

export function assertAppointmentVariablesRenderable(
  variables: Record<string, string | boolean | undefined>,
): void {
  const critical = [
    'employeeName',
    'department',
    'designation',
    'branchName',
    'dutyTotalHours',
    'monthlyAllowedLeaves',
    'shortLeaveHours',
    'serviceArea',
    'stipendAmount',
    'chairmanAdminName',
    'scheduleFrom',
    'scheduleTo',
  ];
  const bad = critical.filter((key) => {
    const value = variables[key];
    if (value === undefined || value === null) return true;
    if (typeof value === 'boolean') return false;
    const text = String(value).trim();
    if (!text) return true;
    if (text === 'undefined' || text === 'null' || text === 'NaN') return true;
    return false;
  });
  if (bad.length) {
    throw new BadRequestException(
      `Appointment Letter cannot be rendered because these fields are empty: ${bad.join(', ')}.`,
    );
  }
}
