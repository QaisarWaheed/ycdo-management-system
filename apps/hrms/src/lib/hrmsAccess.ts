import type { User } from '@/types'

/** HRMS access for system accounts, or employee accounts with staff/system roles. */
export function isHrmsSystemUser(
  user?: Pick<User, 'employeeId' | 'role' | 'roles'> | null,
): boolean {
  if (!user) return false
  if (!user.employeeId) return true
  const roles = user.roles?.length ? user.roles : [user.role]
  return roles.some((role) => role && role !== 'EMPLOYEE')
}
