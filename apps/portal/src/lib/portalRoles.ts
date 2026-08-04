import type { User } from '@/types'

/** Roles that may use the portal without an employee profile (HRMS executives). */
export const PORTAL_EXECUTIVE_ROLES = [
  'PRESIDENT',
  'FOUNDER',
  'CHAIRMAN',
] as const

export type PortalExecutiveRole = (typeof PORTAL_EXECUTIVE_ROLES)[number]

export function userEffectiveRoles(
  user?: Pick<User, 'role' | 'roles'> | null,
): string[] {
  if (!user) return []
  if (user.roles?.length) return user.roles
  return user.role ? [user.role] : []
}

export function isPortalExecutiveUser(
  user?: Pick<User, 'role' | 'roles'> | null,
): boolean {
  const roles = userEffectiveRoles(user)
  return PORTAL_EXECUTIVE_ROLES.some((r) => roles.includes(r))
}

/** Linked employee account (attendance, leave, payroll, etc.). */
export function isPortalEmployeeUser(
  user?: Pick<User, 'employeeId'> | null,
): boolean {
  return !!user?.employeeId
}

/** Who may sign in and use the Employee Portal app. */
export function canAccessPortal(
  user?: Pick<User, 'employeeId' | 'role' | 'roles'> | null,
): boolean {
  return isPortalEmployeeUser(user) || isPortalExecutiveUser(user)
}

export function portalRoleLabel(role?: string | null): string {
  switch (role) {
    case 'PRESIDENT':
      return 'President'
    case 'FOUNDER':
      return 'Founder'
    case 'CHAIRMAN':
      return 'Chairman Admin'
    default:
      return role?.replace(/_/g, ' ') ?? 'User'
  }
}
