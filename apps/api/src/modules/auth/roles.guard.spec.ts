import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, UserRole } from '@prisma/client';
import {
  ALSO_ALLOW_PERMISSIONS_KEY,
  ROLES_KEY,
  ROUTE_PERMISSION_KEY,
} from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { rolesDefaultAllow } from '../permissions/permissions.constants';

type Meta = {
  roles?: UserRole[];
  routePermission?: Permission;
  alsoAllow?: Permission[];
};

function setup(
  userRole: UserRole,
  meta: Meta,
  overrides: Partial<Record<Permission, boolean>> = {},
) {
  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === ROLES_KEY) return meta.roles;
      if (key === ROUTE_PERMISSION_KEY) return meta.routePermission;
      if (key === ALSO_ALLOW_PERMISSIONS_KEY) return meta.alsoAllow;
      return undefined;
    },
  } as unknown as Reflector;
  const permissionsService = {
    getUserEffectiveRoles: jest.fn(async () => [userRole]),
    getOverride: jest.fn(async (_id: string, p: Permission) =>
      overrides[p] === undefined ? null : overrides[p],
    ),
    userHasPermission: jest.fn(
      async (_id: string, role: UserRole, p: Permission) =>
        overrides[p] ?? rolesDefaultAllow([role], p),
    ),
  };
  const accessScopeService = {
    userHasManagerScopes: jest.fn(async () => false),
  };
  const guard = new RolesGuard(
    reflector,
    permissionsService as any,
    accessScopeService as any,
  );
  const context = {
    getHandler: () => undefined,
    getClass: () => ({ name: 'TestController' }),
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'u1', role: userRole } }),
    }),
  } as unknown as ExecutionContext;
  return () => guard.canActivate(context);
}

describe('RolesGuard with Login Access permissions', () => {
  const lettersRoute: Meta = {
    roles: [UserRole.HR_MANAGER, UserRole.ADMIN_OFFICER],
    routePermission: Permission.LETTERS_GENERATE,
  };

  it('opens a permission route for a role whose default allows it', async () => {
    await expect(
      setup(UserRole.PROGRESS_OFFICER, lettersRoute)(),
    ).resolves.toBe(true);
  });

  it('opens a permission route when IT grants it to a role not listed', async () => {
    await expect(
      setup(UserRole.MEDICINE_MANAGER, lettersRoute, {
        LETTERS_GENERATE: true,
      })(),
    ).resolves.toBe(true);
  });

  it('closes a permission route when IT denies it, even for a listed role', async () => {
    await expect(
      setup(UserRole.HR_MANAGER, lettersRoute, { LETTERS_GENERATE: false })(),
    ).resolves.toBe(false);
  });

  it('keeps @Roles access for listed roles without the permission default', async () => {
    await expect(
      setup(UserRole.EMPLOYEE, {
        roles: [UserRole.EMPLOYEE],
        routePermission: Permission.LETTERS_GENERATE,
      })(),
    ).resolves.toBe(true);
  });

  it('lets an also-allow permission open shared data without deny closing it', async () => {
    const attendanceRoute: Meta = {
      roles: [UserRole.HR_MANAGER],
      alsoAllow: [Permission.REPORTS_VIEW],
    };
    await expect(
      setup(UserRole.PAYROLL_OFFICER, attendanceRoute)(),
    ).resolves.toBe(true);
    await expect(
      setup(UserRole.HR_MANAGER, attendanceRoute, { REPORTS_VIEW: false })(),
    ).resolves.toBe(true);
    await expect(
      setup(UserRole.MEDICINE_MANAGER, attendanceRoute)(),
    ).resolves.toBe(false);
  });
});
