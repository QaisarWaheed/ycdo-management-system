import type { User } from '@/types'

/** HRMS is for system logins only — accounts not linked to an employee record. */
export function isHrmsSystemUser(user?: Pick<User, 'employeeId'> | null): boolean {
  return !!user && !user.employeeId
}
