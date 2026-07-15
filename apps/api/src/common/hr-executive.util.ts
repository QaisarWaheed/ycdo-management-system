import { UserRole } from '@prisma/client';

/** Roles that may edit employee personal data (profile, documents, qualifications). */
export const HR_PERSONAL_EDIT_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.IT_ADMIN,
  UserRole.HR_EXECUTIVE,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.ADMIN_OFFICER,
  UserRole.ADMIN_MANAGER,
];
