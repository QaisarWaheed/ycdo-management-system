export const PORTAL_ALLOWED_ROLES = [
  'EMPLOYEE',
  'ADMIN_MANAGER',
  'HR_MANAGER',
  'HR_ADMIN_MANAGER',
  'HR_OPERATIONS_MANAGER',
  'IT_ADMIN',
  'ADMIN_OFFICER',
] as const

export type PortalRole = (typeof PORTAL_ALLOWED_ROLES)[number]

export function isPortalAllowedRole(role?: string | null): role is PortalRole {
  return !!role && PORTAL_ALLOWED_ROLES.includes(role as PortalRole)
}

export function isEmployeePortalRole(role?: string | null): boolean {
  return role === 'EMPLOYEE'
}
