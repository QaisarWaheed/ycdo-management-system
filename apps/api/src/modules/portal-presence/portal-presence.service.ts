import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PORTAL_ONLINE_WINDOW_MINUTES,
  PortalPresenceQueryDto,
  PortalPresenceStatus,
} from './portal-presence.dto';

function onlineSince(): Date {
  return new Date(Date.now() - PORTAL_ONLINE_WINDOW_MINUTES * 60 * 1000);
}

function resolveStatus(
  lastPortalLogin: Date | null,
  cutoff: Date,
): PortalPresenceStatus {
  if (!lastPortalLogin) return 'NEVER_LOGGED_IN';
  if (lastPortalLogin.getTime() >= cutoff.getTime()) return 'ONLINE';
  return 'OFFLINE';
}

@Injectable()
export class PortalPresenceService {
  constructor(private prisma: PrismaService) {}

  async getSummary() {
    const cutoff = onlineSince();

    const baseWhere: Prisma.UserWhereInput = {
      employeeId: { not: null },
      isActive: true,
      employee: {
        status: { in: ['ACTIVE', 'APPOINTED', 'ON_LEAVE'] },
      },
    };

    const [withPortalAccount, online, neverLoggedIn, offline] =
      await Promise.all([
        this.prisma.user.count({ where: baseWhere }),
        this.prisma.user.count({
          where: {
            ...baseWhere,
            lastPortalLogin: { gte: cutoff },
          },
        }),
        this.prisma.user.count({
          where: {
            ...baseWhere,
            lastPortalLogin: null,
          },
        }),
        this.prisma.user.count({
          where: {
            ...baseWhere,
            AND: [
              { lastPortalLogin: { not: null } },
              { lastPortalLogin: { lt: cutoff } },
            ],
          },
        }),
      ]);

    return {
      withPortalAccount,
      online,
      offline,
      neverLoggedIn,
      onlineWindowMinutes: PORTAL_ONLINE_WINDOW_MINUTES,
    };
  }

  async findAll(query: PortalPresenceQueryDto) {
    const cutoff = onlineSince();

    const where: Prisma.UserWhereInput = {
      employeeId: { not: null },
      isActive: true,
      employee: {
        status: { in: ['ACTIVE', 'APPOINTED', 'ON_LEAVE'] },
        ...(query.branchId
          ? { currentBranchId: query.branchId }
          : {}),
        ...(query.search?.trim()
          ? {
              OR: [
                {
                  fullName: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
                {
                  employeeCode: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
    };

    if (query.status === 'ONLINE') {
      where.lastPortalLogin = { gte: cutoff };
    } else if (query.status === 'NEVER_LOGGED_IN') {
      where.lastPortalLogin = null;
    } else if (query.status === 'OFFLINE') {
      where.AND = [
        { lastPortalLogin: { not: null } },
        { lastPortalLogin: { lt: cutoff } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        isActive: true,
        lastLogin: true,
        lastPortalLogin: true,
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            status: true,
            currentBranch: { select: { id: true, name: true } },
            currentDepartment: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ lastPortalLogin: 'desc' }, { email: 'asc' }],
    });

    return users.map((u) => {
      const status = resolveStatus(u.lastPortalLogin, cutoff);
      return {
        userId: u.id,
        email: u.email,
        isActive: u.isActive,
        lastLogin: u.lastLogin,
        lastPortalLogin: u.lastPortalLogin,
        status,
        employee: u.employee
          ? {
              id: u.employee.id,
              fullName: u.employee.fullName,
              employeeCode: u.employee.employeeCode,
              status: u.employee.status,
              branch: u.employee.currentBranch,
              department: u.employee.currentDepartment,
            }
          : null,
      };
    });
  }
}
