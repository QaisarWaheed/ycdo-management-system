import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserPasswordDto, UserPasswordsQueryDto } from './user-passwords.dto';

@Injectable()
export class UserPasswordsService {
  constructor(private prisma: PrismaService) {}

  findAll(query: UserPasswordsQueryDto = {}) {
    const where: Prisma.UserPasswordWhereInput = {};

    if (query.systemOnly === 'true') {
      where.user = {
        employeeId: null,
        role: UserRole.ADMIN_MANAGER,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.projectId
          ? { branch: { projectId: query.projectId } }
          : {}),
      };
    } else if (query.branchId || query.projectId) {
      where.user = {
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.projectId
          ? { branch: { projectId: query.projectId } }
          : {}),
      };
    }

    return this.prisma.userPassword.findMany({
      where,
      select: {
        id: true,
        userId: true,
        plainText: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            email: true,
            role: true,
            isActive: true,
            branchId: true,
            branch: {
              select: {
                id: true,
                name: true,
                address: true,
                projectId: true,
                project: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: [
        { user: { branch: { name: 'asc' } } },
        { user: { email: 'asc' } },
      ],
    });
  }

  async update(userId: string, dto: UpdateUserPasswordDto, actingUserId: string) {
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
}
