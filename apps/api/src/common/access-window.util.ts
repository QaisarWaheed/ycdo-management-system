import { UserRole } from '@prisma/client';

/** Req 20: logins never limited by an access window. */
export const ACCESS_WINDOW_EXEMPT_ROLES: UserRole[] = [
  UserRole.CHAIRMAN,
  UserRole.PRESIDENT,
  UserRole.FOUNDER,
  UserRole.SUPER_ADMIN,
];

/** Why this login may not be used at `now`, or null when it may. */
export function accessWindowError(
  user: { accessFrom?: Date | null; accessUntil?: Date | null },
  roles: UserRole[],
  now: Date = new Date(),
): string | null {
  if (roles.some((r) => ACCESS_WINDOW_EXEMPT_ROLES.includes(r))) return null;
  if (user.accessFrom && now < user.accessFrom) {
    return `Your access starts on ${user.accessFrom.toISOString()}`;
  }
  if (user.accessUntil && now > user.accessUntil) {
    return 'Your access period has ended. Contact IT.';
  }
  return null;
}
