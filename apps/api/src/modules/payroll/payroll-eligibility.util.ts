import { EmployeeStatus } from '@prisma/client';

/** Default employee statuses included in monthly payroll list / summary / bulk generate. */
export const PAYROLL_DEFAULT_EMPLOYEE_STATUSES: EmployeeStatus[] = [
  EmployeeStatus.ACTIVE,
  EmployeeStatus.ON_REST,
];

export function isPayrollDefaultStatus(status: EmployeeStatus): boolean {
  return (
    PAYROLL_DEFAULT_EMPLOYEE_STATUSES as readonly EmployeeStatus[]
  ).includes(status);
}
