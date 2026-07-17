export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  IT_ADMIN: 'IT Admin',
  PRESIDENT: 'President',
  FOUNDER: 'Founder',
  CHAIRMAN: 'Chairman Admin',
  HR_OPERATIONS_MANAGER: 'HR Operations Manager',
  HR_ADMIN_MANAGER: 'HR Admin Manager',
  HR_EXECUTIVE: 'HR Executive',
  HR_MANAGER: 'HR Manager',
  ADMIN_OFFICER: 'Admin Officer (Dept Incharge)',
  ADMIN_MANAGER: 'Admin Manager (Branch Manager)',
  MEDICINE_MANAGER: 'Medicine Manager',
  DEPARTMENT_HEAD: 'Department Head',
  PAYROLL_OFFICER: 'Payroll Officer',
  EMPLOYEE: 'Employee (Portal)',
}

/** Executive roles may be primary only — never additional. */
export const EXECUTIVE_ROLES = ['PRESIDENT', 'FOUNDER', 'CHAIRMAN'] as const

export const ROLE_GROUPS: { title: string; roles: string[] }[] = [
  {
    title: 'Executive',
    roles: ['PRESIDENT', 'FOUNDER', 'CHAIRMAN'],
  },
  {
    title: 'IT & System',
    roles: ['SUPER_ADMIN', 'IT_ADMIN'],
  },
  {
    title: 'HR',
    roles: [
      'HR_OPERATIONS_MANAGER',
      'HR_ADMIN_MANAGER',
      'HR_EXECUTIVE',
      'HR_MANAGER',
      'PAYROLL_OFFICER',
    ],
  },
  {
    title: 'Branch & Department',
    roles: ['ADMIN_MANAGER', 'ADMIN_OFFICER', 'MEDICINE_MANAGER', 'DEPARTMENT_HEAD'],
  },
  {
    title: 'Staff',
    roles: ['EMPLOYEE'],
  },
]

export function formatRole(role: string) {
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ')
}

export function isExecutiveRole(role: string) {
  return (EXECUTIVE_ROLES as readonly string[]).includes(role)
}
