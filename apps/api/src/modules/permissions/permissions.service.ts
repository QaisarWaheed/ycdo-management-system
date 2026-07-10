import { Injectable } from '@nestjs/common';
import { Permission, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
  roleDefaultAllows,
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

  async userHasPermission(
    userId: string,
    role: UserRole,
    permission: Permission,
  ): Promise<boolean> {
    if (role === UserRole.SUPER_ADMIN) return true;

    const override = await this.prisma.userPermission.findUnique({
      where: {
        userId_permission: { userId, permission },
      },
    });

    if (override) return override.granted;

    return roleDefaultAllows(role, permission);
  }

  async getEffectivePermissions(
    userId: string,
    role: UserRole,
  ): Promise<EffectivePermission[]> {
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
      const effective = roleDefaultAllows(role, permission);
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
