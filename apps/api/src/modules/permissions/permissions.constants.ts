import { Permission, UserRole } from '@prisma/client';

export const PERMISSION_LABELS: Record<Permission, string> = {
  ATTENDANCE_MARK: 'Mark attendance (manual check-in/out)',
  ATTENDANCE_EDIT: 'Edit attendance records',
  LEAVE_APPROVE: 'Approve leave requests',
  LEAVE_APPLY_OTHERS: 'Apply leave on behalf of others',
  PAYROLL_VIEW: 'View payroll',
  PAYROLL_MANAGE: 'Manage payroll',
  EMPLOYEES_VIEW: 'View employees (list, profiles, employee pickers)',
  EMPLOYEES_CREATE: 'Create employees',
  EMPLOYEES_EDIT: 'Edit employee personal info and job info',
  EMPLOYEES_EXPORT:
    'Download employee documents, photos and personal details (Excel)',
  DISCIPLINARY_MANAGE: 'Manage disciplinary cases',
  LETTERS_GENERATE: 'Generate letters',
  INCENTIVES_VIEW: 'View incentives',
  INCENTIVES_MANAGE: 'Manage incentives',
  RECRUITMENT_MANAGE: 'Manage recruitment',
  REPORTS_VIEW: 'View reports',
  BROADCASTS_SEND: 'Send broadcasts',
  ORG_SETUP: 'Organization setup (projects, branches, etc.)',
  ATTENDANCE_VERIFY: 'Verify (lock) a branch month of attendance for payroll',
  PAYROLL_FINALIZE: 'Finalize payroll (mark Processed / Paid)',
};

/** Role defaults when IT has not set an explicit override. */
export const ROLE_PERMISSION_DEFAULTS: Partial<
  Record<Permission, UserRole[]>
> = {
  ATTENDANCE_VERIFY: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
  ],
  PAYROLL_FINALIZE: [UserRole.PAYROLL_OFFICER],
  ATTENDANCE_MARK: [
    UserRole.HR_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.MEDICINE_MANAGER,
  ],
  ATTENDANCE_EDIT: [
    UserRole.IT_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    // Branch admins keep EDIT so they can complete first check-out only;
    // updateAttendance blocks any other modification.
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
    UserRole.MEDICINE_MANAGER,
  ],
  LEAVE_APPROVE: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
  ],
  LEAVE_APPLY_OTHERS: [UserRole.HR_MANAGER, UserRole.ADMIN_MANAGER],
  PAYROLL_VIEW: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    UserRole.IT_ADMIN,
    UserRole.CHAIRMAN,
    UserRole.FOUNDER,
    UserRole.PRESIDENT,
    UserRole.PAYROLL_OFFICER,
  ],
  PAYROLL_MANAGE: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.IT_ADMIN,
  ],
  EMPLOYEES_VIEW: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.MEDICINE_MANAGER,
    UserRole.PAYROLL_OFFICER,
    UserRole.PROGRESS_OFFICER,
    UserRole.CHAIRMAN,
    UserRole.FOUNDER,
    UserRole.PRESIDENT,
    UserRole.IT_ADMIN,
  ],
  EMPLOYEES_CREATE: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
  ],
  EMPLOYEES_EDIT: [
    UserRole.HR_EXECUTIVE,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
    UserRole.IT_ADMIN,
  ],
  EMPLOYEES_EXPORT: [
    UserRole.HR_EXECUTIVE,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
  ],
  DISCIPLINARY_MANAGE: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    UserRole.ADMIN_MANAGER,
    UserRole.IT_ADMIN,
  ],
  LETTERS_GENERATE: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.IT_ADMIN,
    UserRole.PAYROLL_OFFICER,
    UserRole.PROGRESS_OFFICER,
  ],
  INCENTIVES_VIEW: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.PRESIDENT,
    UserRole.PAYROLL_OFFICER,
  ],
  INCENTIVES_MANAGE: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.PAYROLL_OFFICER,
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
  ],
  RECRUITMENT_MANAGE: [UserRole.HR_MANAGER],
  REPORTS_VIEW: [
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.PRESIDENT,
    UserRole.PAYROLL_OFFICER,
    UserRole.PROGRESS_OFFICER,
  ],
  BROADCASTS_SEND: [UserRole.IT_ADMIN],
  ORG_SETUP: [UserRole.IT_ADMIN],
};

export const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS) as Permission[];

/** Roles IT can assign when creating or editing system logins. */
export const IT_ASSIGNABLE_ROLES: UserRole[] = Object.values(
  UserRole,
) as UserRole[];

export function roleDefaultAllows(
  role: UserRole,
  permission: Permission,
): boolean {
  if (role === UserRole.SUPER_ADMIN) return true;
  if (role === UserRole.HR_EXECUTIVE) return true;
  const allowedRoles = ROLE_PERMISSION_DEFAULTS[permission] ?? [];
  return allowedRoles.includes(role);
}

export function rolesDefaultAllow(
  roles: UserRole[],
  permission: Permission,
): boolean {
  return roles.some((role) => roleDefaultAllows(role, permission));
}
