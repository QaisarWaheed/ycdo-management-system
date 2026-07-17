import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IT_ASSIGNABLE_ROLES,
  PERMISSION_LABELS,
  roleDefaultAllows,
} from '../permissions/permissions.constants';
import { AccessScopeService } from '../permissions/access-scope.service';
import { PermissionsService } from '../permissions/permissions.service';
import { buildEffectiveRoles } from '../../common/user-roles.util';
import {
  CreateSystemLoginDto,
  ResetLoginPasswordDto,
  UpdateUserAccessDto,
  UserAccessQueryDto,
} from './user-access.dto';

@Injectable()
export class UserAccessService {
  constructor(
    private prisma: PrismaService,
    private permissionsService: PermissionsService,
    private accessScopeService: AccessScopeService,
  ) {}

  findAll(query: UserAccessQueryDto = {}) {
    const andConditions: Prisma.UserWhereInput[] = [];

    if (query.systemOnly === 'true') {
      andConditions.push({ employeeId: null });
    } else if (query.employeeOnly === 'true') {
      andConditions.push({ employeeId: { not: null } });
    }

    if (query.branchId) {
      andConditions.push({
        OR: [
          { branchId: query.branchId },
          { employee: { currentBranchId: query.branchId } },
        ],
      });
    }

    if (query.projectId) {
      andConditions.push({
        OR: [
          { branch: { projectId: query.projectId } },
          { employee: { currentBranch: { projectId: query.projectId } } },
        ],
      });
    }

    if (query.activeOnly === 'true') {
      andConditions.push({ isActive: true });
    } else if (query.activeOnly === 'false') {
      andConditions.push({ isActive: false });
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      andConditions.push({
        OR: [
          { email: { contains: term, mode: 'insensitive' } },
          {
            employee: {
              OR: [
                { fullName: { contains: term, mode: 'insensitive' } },
                { employeeCode: { contains: term, mode: 'insensitive' } },
              ],
            },
          },
        ],
      });
    }

    const where: Prisma.UserWhereInput =
      andConditions.length > 0 ? { AND: andConditions } : {};

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        branchId: true,
        employeeId: true,
        createdAt: true,
        lastLogin: true,
        employee: {
          select: {
            fullName: true,
            employeeCode: true,
            currentBranch: {
              select: {
                id: true,
                name: true,
                abbreviation: true,
                address: true,
                projectId: true,
                project: { select: { id: true, name: true } },
              },
            },
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
            abbreviation: true,
            address: true,
            projectId: true,
            project: { select: { id: true, name: true } },
          },
        },
        passwordRecord: {
          select: { plainText: true, updatedAt: true },
        },
        permissions: {
          select: { permission: true, granted: true },
        },
        additionalRoles: {
          select: { role: true },
        },
        managerScopes: {
          where: { isActive: true },
          select: {
            id: true,
            projectId: true,
            departmentId: true,
            designationId: true,
            project: { select: { name: true } },
            department: { select: { name: true } },
            designation: { select: { title: true } },
          },
        },
      },
      orderBy: [{ email: 'asc' }],
    }).then((users) =>
      users.map((user) => {
        const additionalRoles = user.additionalRoles.map((entry) => entry.role);
        const managerScopes = user.managerScopes.map((scope) => ({
          id: scope.id,
          projectId: scope.projectId,
          projectName: scope.project.name,
          departmentId: scope.departmentId,
          departmentName: scope.department.name,
          designationId: scope.designationId,
          designationTitle: scope.designation?.title ?? null,
          label: [
            scope.project.name,
            scope.department.name,
            scope.designation?.title ?? 'All designations',
          ].join(' · '),
        }));
        return {
          ...user,
          additionalRoles,
          managerScopes,
          roles: buildEffectiveRoles(user.role, additionalRoles),
        };
      }),
    );
  }

  async getSummary() {
    const [total, employeeLogins, systemLogins, active, disabled, missingLogins] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { employeeId: { not: null } } }),
        this.prisma.user.count({ where: { employeeId: null } }),
        this.prisma.user.count({ where: { isActive: true } }),
        this.prisma.user.count({ where: { isActive: false } }),
        this.prisma.employee.count({ where: { user: null } }),
      ]);

    return {
      total,
      employeeLogins,
      systemLogins,
      active,
      disabled,
      missingEmployeeLogins: missingLogins,
    };
  }

  async syncEmployeeLogins(actingUserId: string) {
    const employees = await this.prisma.employee.findMany({
      where: { user: null },
      select: {
        id: true,
        employeeCode: true,
        email: true,
        currentDesignation: true,
        currentBranchId: true,
      },
    });

    let created = 0;

    for (const employee of employees) {
      const loginEmail =
        employee.email || `${employee.employeeCode.toLowerCase()}@ycdo.org`;

      const existingUser = await this.prisma.user.findUnique({
        where: { email: loginEmail },
      });
      if (existingUser) {
        continue;
      }

      const isAdminManager = employee.currentDesignation === 'Admin Manager';
      const hashedPassword = await bcrypt.hash(employee.employeeCode, 10);

      await this.prisma.$transaction(async (tx) => {
        if (!employee.email) {
          await tx.employee.update({
            where: { id: employee.id },
            data: { email: loginEmail },
          });
        }

        const newUser = await tx.user.create({
          data: {
            email: loginEmail,
            password: hashedPassword,
            role: isAdminManager ? UserRole.ADMIN_MANAGER : UserRole.EMPLOYEE,
            branchId: isAdminManager ? employee.currentBranchId : undefined,
            isActive: true,
            employeeId: employee.id,
          },
        });

        await tx.userPassword.create({
          data: { userId: newUser.id, plainText: employee.employeeCode },
        });
      });

      created++;
    }

    if (created > 0) {
      await this.prisma.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'SYNC_EMPLOYEE_LOGINS',
          entity: 'User',
          entityId: actingUserId,
          changes: { created },
        },
      });
    }

    return { created, remaining: employees.length - created };
  }

  async findOne(userId: string, actingRole: UserRole) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        branchId: true,
        employeeId: true,
        createdAt: true,
        lastLogin: true,
        employee: {
          select: { fullName: true, employeeCode: true },
        },
        branch: {
          select: {
            id: true,
            name: true,
            abbreviation: true,
            project: { select: { id: true, name: true } },
          },
        },
        permissions: {
          select: { permission: true, granted: true },
        },
        additionalRoles: {
          select: { role: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    const additionalRoles = user.additionalRoles.map((entry) => entry.role);
    const roles = buildEffectiveRoles(user.role, additionalRoles);
    const managerScopes = await this.accessScopeService.listManagerScopes(userId);

    const effectivePermissions =
      await this.permissionsService.getEffectivePermissions(user.id, user.role);

    return {
      ...user,
      additionalRoles,
      managerScopes,
      roles,
      effectivePermissions,
      assignableRoles: this.assignableRoles(actingRole, user),
      hospitalScopeOptions:
        await this.accessScopeService.getHospitalScopeOptions(),
    };
  }

  getPermissionCatalog() {
    return this.permissionsService.getPermissionCatalog();
  }

  async getMeta(actingRole: UserRole) {
    return {
      permissions: this.getPermissionCatalog(),
      assignableRoles: this.assignableRoles(actingRole),
      additionalAssignableRoles: this.assignableRoles(actingRole).filter(
        (role) => !this.accessScopeService.isExecutiveRole(role),
      ),
      permissionLabels: this.permissionLabels(),
      hospitalScopeOptions:
        await this.accessScopeService.getHospitalScopeOptions(),
    };
  }

  async update(
    userId: string,
    dto: UpdateUserAccessDto,
    actingUserId: string,
    actingRole: UserRole,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    if (user.role === UserRole.SUPER_ADMIN && actingRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only Super Admin can modify Super Admin accounts');
    }

    if (dto.role) {
      this.assertAssignableRole(dto.role, actingRole, user);
    }
    if (dto.additionalRoles?.length) {
      this.accessScopeService.assertNoExecutiveAdditionalRoles(
        dto.additionalRoles,
      );
      for (const role of dto.additionalRoles) {
        this.assertAssignableRole(role, actingRole, user);
      }
    }

    if (userId === actingUserId && dto.isActive === false) {
      throw new BadRequestException('You cannot disable your own account');
    }

    const nextPrimary = dto.role ?? user.role;
    const nextAdditional = dto.additionalRoles
      ? this.accessScopeService
          .rejectExecutiveAdditionalRoles([...new Set(dto.additionalRoles)])
          .filter((role) => role !== nextPrimary)
      : undefined;

    if (dto.managerScopes !== undefined) {
      await this.accessScopeService.replaceManagerScopes(
        userId,
        dto.managerScopes,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (
        dto.isActive !== undefined ||
        dto.role !== undefined ||
        dto.branchId !== undefined
      ) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            ...(dto.role !== undefined ? { role: dto.role } : {}),
            ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          },
        });
      }

      if (nextAdditional !== undefined) {
        await tx.userAdditionalRole.deleteMany({ where: { userId } });
        if (nextAdditional.length) {
          await tx.userAdditionalRole.createMany({
            data: nextAdditional.map((role) => ({ userId, role })),
          });
        }
      }

      if (dto.permissions?.length) {
        for (const entry of dto.permissions) {
          if (entry.granted === null || entry.granted === undefined) {
            await tx.userPermission.deleteMany({
              where: { userId, permission: entry.permission },
            });
          } else {
            await tx.userPermission.upsert({
              where: {
                userId_permission: {
                  userId,
                  permission: entry.permission,
                },
              },
              update: { granted: entry.granted },
              create: {
                userId,
                permission: entry.permission,
                granted: entry.granted,
              },
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'UPDATE_USER_ACCESS',
          entity: 'User',
          entityId: userId,
          changes: {
            isActive: dto.isActive,
            role: dto.role,
            additionalRoles: nextAdditional,
            managerScopes: dto.managerScopes ?? null,
            branchId: dto.branchId,
            permissions: dto.permissions?.map((p) => ({
              permission: p.permission,
              granted: p.granted,
            })),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });

    return this.findOne(userId, actingRole);
  }

  async toggleActive(
    userId: string,
    actingUserId: string,
    actingRole: UserRole,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    if (user.role === UserRole.SUPER_ADMIN && actingRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only Super Admin can modify Super Admin accounts');
    }

    if (userId === actingUserId) {
      throw new BadRequestException('You cannot disable your own account');
    }

    const isActive = !user.isActive;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { isActive },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: actingUserId,
          action: isActive ? 'ENABLE_USER_LOGIN' : 'DISABLE_USER_LOGIN',
          entity: 'User',
          entityId: userId,
          changes: { isActive },
        },
      }),
    ]);

    return { id: userId, isActive };
  }

  async createSystemLogin(
    dto: CreateSystemLoginDto,
    actingUserId: string,
    actingRole: UserRole,
  ) {
    this.assertAssignableRole(dto.role, actingRole);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new BadRequestException('Email already registered');
    }

    const hashed = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          password: hashed,
          role: dto.role,
          branchId: dto.branchId,
        },
      });

      await tx.userPassword.create({
        data: { userId: created.id, plainText: dto.password },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'CREATE_SYSTEM_LOGIN',
          entity: 'User',
          entityId: created.id,
          changes: { email: dto.email, role: dto.role },
        },
      });

      return created;
    });

    return this.findOne(user.id, actingRole);
  }

  async resetPassword(
    userId: string,
    dto: ResetLoginPasswordDto,
    actingUserId: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    const hashed = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: hashed },
      }),
      this.prisma.userPassword.upsert({
        where: { userId },
        update: { plainText: dto.newPassword },
        create: { userId, plainText: dto.newPassword },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'UPDATE_USER_PASSWORD',
          entity: 'User',
          entityId: userId,
        },
      }),
    ]);

    return { message: 'Password updated' };
  }

  roleDefaultForPermission(role: UserRole, permission: string) {
    return roleDefaultAllows(role, permission as never);
  }

  permissionLabels() {
    return PERMISSION_LABELS;
  }

  assignableRoles(actingRole: UserRole, user?: { employeeId?: string | null }) {
    const allRoles = Object.values(UserRole) as UserRole[];

    if (
      actingRole === UserRole.IT_ADMIN ||
      actingRole === UserRole.SUPER_ADMIN
    ) {
      if (user?.employeeId) {
        return [...new Set([UserRole.EMPLOYEE, UserRole.ADMIN_MANAGER, ...allRoles])];
      }
      return allRoles;
    }

    const base = [...IT_ASSIGNABLE_ROLES];

    if (user?.employeeId) {
      return [...new Set([UserRole.EMPLOYEE, UserRole.ADMIN_MANAGER, ...base])];
    }

    return base;
  }

  private assertAssignableRole(
    role: UserRole,
    actingRole: UserRole,
    user?: { employeeId?: string | null },
  ) {
    const allowed = this.assignableRoles(actingRole, user);
    if (!allowed.includes(role)) {
      throw new ForbiddenException(`Role ${role} cannot be assigned`);
    }
  }
}
