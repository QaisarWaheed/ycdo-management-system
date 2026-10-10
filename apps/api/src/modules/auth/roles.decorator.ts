import { SetMetadata } from '@nestjs/common';
import { Permission, UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const ROUTE_PERMISSION_KEY = 'routePermission';
export const ALSO_ALLOW_PERMISSIONS_KEY = 'alsoAllowPermissions';
export const STRICT_ROLES_KEY = 'strictRoles';

/**
 * Only the listed @Roles may call the route: no HR Executive pass-through and
 * no Login Access permission shortcut (Super Admin still passes). Used for
 * pay changes, which belong to Finance and executives only.
 */
export const StrictRoles = () => SetMetadata(STRICT_ROLES_KEY, true);

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Ties a route to a Login Access permission. An IT "Allow" override opens the
 * route even when the role is not in @Roles; an IT "Deny" override closes it
 * even when the role is.
 */
export const RoutePermission = (permission: Permission) =>
  SetMetadata(ROUTE_PERMISSION_KEY, permission);

/**
 * Extra permissions that also open a shared data route (e.g. Reports reading
 * attendance). Allow or the role default opens it; Deny does not close it,
 * because the route belongs to another section.
 */
export const AlsoAllowPermission = (...permissions: Permission[]) =>
  SetMetadata(ALSO_ALLOW_PERMISSIONS_KEY, permissions);
