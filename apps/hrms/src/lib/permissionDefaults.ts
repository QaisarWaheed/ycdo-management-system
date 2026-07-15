/** Mirrors API ROLE_PERMISSION_DEFAULTS for legacy sessions without `user.permissions`. */
const ROLE_PERMISSION_FALLBACK: Record<string, string[]> = {
  ATTENDANCE_MARK: ['HR_MANAGER', 'ADMIN_MANAGER', 'MEDICINE_MANAGER'],
  ATTENDANCE_EDIT: [
    'HR_MANAGER',
    'HR_ADMIN_MANAGER',
    'ADMIN_OFFICER',
    'ADMIN_MANAGER',
    'MEDICINE_MANAGER',
  ],
  EMPLOYEES_CREATE: [
    'HR_MANAGER',
    'HR_ADMIN_MANAGER',
    'ADMIN_OFFICER',
    'ADMIN_MANAGER',
  ],
  EMPLOYEES_EDIT: [
    'HR_EXECUTIVE',
    'HR_MANAGER',
    'HR_ADMIN_MANAGER',
    'HR_OPERATIONS_MANAGER',
    'ADMIN_OFFICER',
    'ADMIN_MANAGER',
    'IT_ADMIN',
  ],
}

export function roleAllowsPermission(role: string, permission: string): boolean {
  if (role === 'SUPER_ADMIN' || role === 'HR_EXECUTIVE') return true
  return ROLE_PERMISSION_FALLBACK[permission]?.includes(role) ?? false
}
