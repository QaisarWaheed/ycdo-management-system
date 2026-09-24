import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, UserRole } from '@prisma/client';
import {
  ALSO_ALLOW_PERMISSIONS_KEY,
  ROLES_KEY,
  ROUTE_PERMISSION_KEY,
} from './roles.decorator';
import { AccessScopeService } from '../permissions/access-scope.service';
import { PermissionsService } from '../permissions/permissions.service';
import { hasAnyRole } from '../../common/user-roles.util';
import { rolesDefaultAllow } from '../permissions/permissions.constants';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
    private accessScopeService: AccessScopeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    const routePermission = this.reflector.getAllAndOverride<
      Permission | undefined
    >(ROUTE_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    const alsoAllow =
      this.reflector.getAllAndOverride<Permission[] | undefined>(
        ALSO_ALLOW_PERMISSIONS_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? [];

    if (
      (!requiredRoles || requiredRoles.length === 0) &&
      !routePermission &&
      alsoAllow.length === 0
    ) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user?.id) return false;

    const effectiveRoles =
      (user.roles as UserRole[] | undefined)?.length
        ? (user.roles as UserRole[])
        : await this.permissionsService.getUserEffectiveRoles(user.id);

    user.roles = effectiveRoles;
    user.role = user.role ?? effectiveRoles[0];

    if (hasAnyRole(effectiveRoles, [UserRole.SUPER_ADMIN])) {
      return true;
    }

    // Permission-tied routes follow Login Access: an IT Deny closes the
    // route, an IT Allow or the role default opens it; otherwise @Roles decides.
    if (routePermission) {
      const override = await this.permissionsService.getOverride(
        user.id,
        routePermission,
      );
      if (override === false) return false;
      if (override === true) return true;
      if (rolesDefaultAllow(effectiveRoles, routePermission)) return true;
    }

    for (const permission of alsoAllow) {
      if (
        await this.permissionsService.userHasPermission(
          user.id,
          user.role,
          permission,
        )
      ) {
        return true;
      }
    }

    if (!requiredRoles || requiredRoles.length === 0) return false;

    if (hasAnyRole(effectiveRoles, [UserRole.HR_EXECUTIVE])) {
      const controllerName = context.getClass().name;
      if (controllerName === 'UserPasswordsController') {
        return false;
      }
      return true;
    }

    if (hasAnyRole(effectiveRoles, requiredRoles)) {
      return true;
    }

    // Hospital manager scopes grant Admin Officer route capability;
    // row-level checks still enforce department/designation matching.
    if (
      requiredRoles.includes(UserRole.ADMIN_OFFICER) &&
      (await this.accessScopeService.userHasManagerScopes(user.id))
    ) {
      return true;
    }

    return false;
  }
}
