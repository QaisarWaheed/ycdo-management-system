/** Display label for Employee.status, shared by badges, print reports and payslips. */
export function employeeStatusLabel(status: string): string {
  if (status === 'DISMISSED') return 'Dismissed'
  if (status === 'ON_REST') return 'On Rest'
  if (status === 'APPOINTED') return 'Active'
  return status.replace(/_/g, ' ')
}
