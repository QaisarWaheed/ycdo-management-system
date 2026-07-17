import { Injectable } from '@nestjs/common';
import { Permission, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildEffectiveRoles } from '../../common/user-roles.util';
import {
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
  roleDefaultAllows,
  rolesDefaultAllow,
} from './permissions.constants';

export type PermissionOverride = {
  permission: Permission;
  granted: boolean;
};

export type EffectivePermission = {
  permission: Permission;
  label: string;
  effective: boolean;
  source: 'role' | 'override_grant' | 'override_deny';
};

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  async getUserEffectiveRoles(userId: string): Promise<UserRole[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        additionalRoles: { select: { role: true } },
      },
    });
    if (!user) return [];
    return buildEffectiveRoles(user.role, user.additionalRoles);
  }

  async userHasPermission(
    userId: string,
    role: UserRole,
    permission: Permission,
  ): Promise<boolean> {
    const effectiveRoles = await this.getUserEffectiveRoles(userId);
    const roles = effectiveRoles.length ? effectiveRoles : [role];

    if (roles.includes(UserRole.SUPER_ADMIN)) return true;

    const override = await this.prisma.userPermission.findUnique({
      where: {
        userId_permission: { userId, permission },
      },
    });

    if (override) return override.granted;

    return rolesDefaultAllow(roles, permission);
  }

  async getEffectivePermissions(
    userId: string,
    role: UserRole,
    additionalRoles?: UserRole[],
  ): Promise<EffectivePermission[]> {
    let roles: UserRole[];
    if (additionalRoles) {
      roles = buildEffectiveRoles(role, additionalRoles);
    } else {
      roles = await this.getUserEffectiveRoles(userId);
      if (!roles.length) roles = [role];
    }

    const overrides = await this.prisma.userPermission.findMany({
      where: { userId },
    });
    const overrideMap = new Map(
      overrides.map((o) => [o.permission, o.granted]),
    );

    return ALL_PERMISSIONS.map((permission) => {
      const override = overrideMap.get(permission);
      if (override === true) {
        return {
          permission,
          label: PERMISSION_LABELS[permission],
          effective: true,
          source: 'override_grant' as const,
        };
      }
      if (override === false) {
        return {
          permission,
          label: PERMISSION_LABELS[permission],
          effective: false,
          source: 'override_deny' as const,
        };
      }
      const effective = rolesDefaultAllow(roles, permission);
      return {
        permission,
        label: PERMISSION_LABELS[permission],
        effective,
        source: 'role' as const,
      };
    });
  }

  getPermissionCatalog() {
    return ALL_PERMISSIONS.map((permission) => ({
      permission,
      label: PERMISSION_LABELS[permission],
    }));
  }
}
