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
import { PermissionsService } from '../permissions/permissions.service';
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
  ) {}

  findAll(query: UserAccessQueryDto = {}) {
    const where: Prisma.UserWhereInput = {};

    if (query.systemOnly === 'true') {
      where.employeeId = null;
    } else if (query.employeeOnly === 'true') {
      where.employeeId = { not: null };
    }

    if (query.branchId) {
      where.branchId = query.branchId;
    }

    if (query.projectId) {
      where.branch = { projectId: query.projectId };
    }

    if (query.activeOnly === 'true') {
      where.isActive = true;
    } else if (query.activeOnly === 'false') {
      where.isActive = false;
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        {
          employee: {
            OR: [
              { fullName: { contains: term, mode: 'insensitive' } },
              { employeeCode: { contains: term, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

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
      },
      orderBy: [{ email: 'asc' }],
    });
  }

  async findOne(userId: string) {
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
      },
    });

    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    const effectivePermissions =
      await this.permissionsService.getEffectivePermissions(user.id, user.role);

    return { ...user, effectivePermissions };
  }

  getPermissionCatalog() {
    return this.permissionsService.getPermissionCatalog();
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
      this.assertAssignableRole(dto.role, actingRole);
    }

    if (userId === actingUserId && dto.isActive === false) {
      throw new BadRequestException('You cannot disable your own account');
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
            branchId: dto.branchId,
            permissions: dto.permissions?.map((p) => ({
              permission: p.permission,
              granted: p.granted,
            })),
          },
        },
      });
    });

    return this.findOne(userId);
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

    return this.findOne(user.id);
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

  assignableRoles(actingRole: UserRole) {
    if (actingRole === UserRole.SUPER_ADMIN) {
      return [...IT_ASSIGNABLE_ROLES, UserRole.SUPER_ADMIN];
    }
    return IT_ASSIGNABLE_ROLES;
  }

  private assertAssignableRole(role: UserRole, actingRole: UserRole) {
    const allowed = this.assignableRoles(actingRole);
    if (!allowed.includes(role)) {
      throw new ForbiddenException(`Role ${role} cannot be assigned`);
    }
  }
}
