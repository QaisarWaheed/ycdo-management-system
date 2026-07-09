import { Permission, UserRole } from '@prisma/client';

export const PERMISSION_LABELS: Record<Permission, string> = {
  ATTENDANCE_MARK: 'Mark attendance (manual check-in/out)',
  ATTENDANCE_EDIT: 'Edit attendance records',
  LEAVE_APPROVE: 'Approve leave requests',
  LEAVE_APPLY_OTHERS: 'Apply leave on behalf of others',
  PAYROLL_MANAGE: 'Manage payroll',
  EMPLOYEES_CREATE: 'Create employees',
  EMPLOYEES_EDIT: 'Edit employees',
  DISCIPLINARY_MANAGE: 'Manage disciplinary cases',
  LETTERS_GENERATE: 'Generate letters',
  INCENTIVES_MANAGE: 'Manage incentives',
  RECRUITMENT_MANAGE: 'Manage recruitment',
  REPORTS_VIEW: 'View reports',
  BROADCASTS_SEND: 'Send broadcasts',
  ORG_SETUP: 'Organization setup (projects, branches, etc.)',
};

/** Role defaults when IT has not set an explicit override. */
export const ROLE_PERMISSION_DEFAULTS: Partial<
  Record<Permission, UserRole[]>
> = {
  ATTENDANCE_MARK: [
    UserRole.HR_MANAGER,
    UserRole.ADMIN_MANAGER,
  ],
  ATTENDANCE_EDIT: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
  ],
  LEAVE_APPROVE: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
  ],
  LEAVE_APPLY_OTHERS: [UserRole.HR_MANAGER, UserRole.ADMIN_MANAGER],
  PAYROLL_MANAGE: [
    UserRole.HR_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
  ],
  EMPLOYEES_CREATE: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
  ],
  EMPLOYEES_EDIT: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
    UserRole.IT_ADMIN,
  ],
  DISCIPLINARY_MANAGE: [UserRole.HR_MANAGER, UserRole.ADMIN_MANAGER],
  LETTERS_GENERATE: [UserRole.HR_MANAGER, UserRole.ADMIN_MANAGER],
  INCENTIVES_MANAGE: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  ],
  RECRUITMENT_MANAGE: [UserRole.HR_MANAGER],
  REPORTS_VIEW: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
  ],
  BROADCASTS_SEND: [UserRole.IT_ADMIN],
  ORG_SETUP: [UserRole.IT_ADMIN],
};

export const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS) as Permission[];

/** Roles IT can assign when creating or editing system logins. */
export const IT_ASSIGNABLE_ROLES: UserRole[] = [
  UserRole.IT_ADMIN,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_EXECUTIVE,
  UserRole.HR_MANAGER,
  UserRole.ADMIN_OFFICER,
  UserRole.ADMIN_MANAGER,
  UserRole.FOUNDER,
  UserRole.CHAIRMAN,
];

export function roleDefaultAllows(
  role: UserRole,
  permission: Permission,
): boolean {
  if (role === UserRole.SUPER_ADMIN) return true;
  if (role === UserRole.HR_EXECUTIVE) return true;
  const allowedRoles = ROLE_PERMISSION_DEFAULTS[permission] ?? [];
  return allowedRoles.includes(role);
}
