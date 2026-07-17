import { UserRole } from '@prisma/client';

export function dedupeRoles(roles: UserRole[]): UserRole[] {
  const seen = new Set<UserRole>();
  const result: UserRole[] = [];
  for (const role of roles) {
    if (!role || seen.has(role)) continue;
    seen.add(role);
    result.push(role);
  }
  return result;
}

export function buildEffectiveRoles(
  primaryRole: UserRole,
  additionalRoles: Array<UserRole | { role: UserRole }> = [],
): UserRole[] {
  const extras = additionalRoles.map((entry) =>
    typeof entry === 'string' ? entry : entry.role,
  );
  return dedupeRoles([primaryRole, ...extras]);
}

export function hasAnyRole(
  effectiveRoles: UserRole[] | undefined,
  candidates: UserRole[],
): boolean {
  if (!effectiveRoles?.length) return false;
  return candidates.some((role) => effectiveRoles.includes(role));
}

export const ROLE_ASSIGNERS: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.IT_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
];

export function canAssignRoles(effectiveRoles: UserRole[]): boolean {
  return hasAnyRole(effectiveRoles, ROLE_ASSIGNERS);
}

/** Staff/system roles that unlock HRMS for employee-linked accounts. */
export function canAccessHrms(effectiveRoles: UserRole[]): boolean {
  return effectiveRoles.some((role) => role !== UserRole.EMPLOYEE);
}
