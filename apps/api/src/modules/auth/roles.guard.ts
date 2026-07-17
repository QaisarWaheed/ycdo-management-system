import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { PermissionsService } from '../permissions/permissions.service';
import { hasAnyRole } from '../../common/user-roles.util';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
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

    if (hasAnyRole(effectiveRoles, [UserRole.HR_EXECUTIVE])) {
      const controllerName = context.getClass().name;
      if (controllerName === 'UserPasswordsController') {
        return false;
      }
      return true;
    }

    return hasAnyRole(effectiveRoles, requiredRoles);
  }
}
