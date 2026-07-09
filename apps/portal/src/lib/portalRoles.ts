import type { User } from '@/types'

/** Portal is for employee-linked logins — role (pharmacist, receptionist, etc.) does not matter. */
export function isPortalEmployeeUser(
  user?: Pick<User, 'employeeId'> | null,
): boolean {
  return !!user?.employeeId
}
