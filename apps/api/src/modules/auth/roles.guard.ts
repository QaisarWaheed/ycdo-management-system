import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (user?.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    if (user?.role === UserRole.HR_EXECUTIVE) {
      const controllerName = context.getClass().name;
      if (controllerName === 'UserPasswordsController') {
        return false;
      }
      return true;
    }

    return requiredRoles.includes(user?.role);
  }
}
