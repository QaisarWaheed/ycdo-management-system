import { Injectable, NotFoundException } from '@nestjs/common';
import { BroadcastTarget, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBroadcastDto } from './broadcasts.dto';

@Injectable()
export class BroadcastsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateBroadcastDto, createdById: string) {
    const broadcast = await this.prisma.notificationBroadcast.create({
      data: {
        title: dto.title,
        message: dto.message,
        targetRole: dto.targetRole,
        createdById,
      },
    });

    let notificationCount = 0;

    if (dto.targetRole === BroadcastTarget.ALL) {
      const employees = await this.prisma.employee.findMany({
        select: { id: true },
      });

      for (const employee of employees) {
        await this.prisma.notification.create({
          data: {
            employeeId: employee.id,
            message: `${dto.title}: ${dto.message}`,
            type: 'BROADCAST',
          },
        });
        notificationCount++;
      }
    } else {
      const role = dto.targetRole as unknown as UserRole;
      const users = await this.prisma.user.findMany({
        where: { role, isActive: true, employeeId: { not: null } },
      });

      for (const user of users) {
        if (user.employeeId) {
          await this.prisma.notification.create({
            data: {
              employeeId: user.employeeId,
              message: `${dto.title}: ${dto.message}`,
              type: 'BROADCAST',
            },
          });
          notificationCount++;
        }
      }
    }

    return { ...broadcast, notificationCount };
  }

  findAll() {
    return this.prisma.notificationBroadcast.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { email: true } },
      },
    });
  }

  async deactivate(id: string) {
    const broadcast = await this.prisma.notificationBroadcast.findUnique({
      where: { id },
    });

    if (!broadcast) {
      throw new NotFoundException(`Broadcast with id ${id} not found`);
    }

    return this.prisma.notificationBroadcast.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
