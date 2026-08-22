import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PortalPresenceQueryDto,
  PortalPresenceStatus,
} from './portal-presence.dto';

/** Same base set as Login Access → Employee (Portal): linked employee logins. */
function employeePortalWhere(
  extra?: Prisma.UserWhereInput,
): Prisma.UserWhereInput {
  return {
    employeeId: { not: null },
    ...extra,
  };
}

function hasLoggedIntoPortalWhere(): Prisma.UserWhereInput {
  return {
    OR: [{ lastPortalLogin: { not: null } }, { lastLogin: { not: null } }],
  };
}

function neverLoggedIntoPortalWhere(): Prisma.UserWhereInput {
  return {
    lastPortalLogin: null,
    lastLogin: null,
  };
}

function resolveStatus(
  lastPortalLogin: Date | null,
  lastLogin: Date | null,
): PortalPresenceStatus {
  if (lastPortalLogin || lastLogin) return 'LOGGED_IN';
  return 'NEVER_LOGGED_IN';
}

function effectivePortalLogin(
  lastPortalLogin: Date | null,
  lastLogin: Date | null,
): Date | null {
  return lastPortalLogin ?? lastLogin;
}

@Injectable()
export class PortalPresenceService {
  constructor(private prisma: PrismaService) {}

  async getSummary() {
    const baseWhere = employeePortalWhere();

    const [withPortalAccount, loggedIn, neverLoggedIn, active, disabled] =
      await Promise.all([
        this.prisma.user.count({ where: baseWhere }),
        this.prisma.user.count({
          where: employeePortalWhere(hasLoggedIntoPortalWhere()),
        }),
        this.prisma.user.count({
          where: employeePortalWhere(neverLoggedIntoPortalWhere()),
        }),
        this.prisma.user.count({
          where: employeePortalWhere({ isActive: true }),
        }),
        this.prisma.user.count({
          where: employeePortalWhere({ isActive: false }),
        }),
      ]);

    return {
      withPortalAccount,
      loggedIn,
      neverLoggedIn,
      active,
      disabled,
    };
  }

  async findAll(query: PortalPresenceQueryDto) {
    const where: Prisma.UserWhereInput = employeePortalWhere({
      employee: {
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
    });

    if (query.status === 'LOGGED_IN') {
      Object.assign(where, hasLoggedIntoPortalWhere());
    } else if (query.status === 'NEVER_LOGGED_IN') {
      Object.assign(where, neverLoggedIntoPortalWhere());
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
      orderBy: [{ lastPortalLogin: 'desc' }, { lastLogin: 'desc' }, { email: 'asc' }],
    });

    return users.map((u) => {
      const lastPortalLoginAt = effectivePortalLogin(
        u.lastPortalLogin,
        u.lastLogin,
      );
      const status = resolveStatus(u.lastPortalLogin, u.lastLogin);
      return {
        userId: u.id,
        email: u.email,
        isActive: u.isActive,
        lastLogin: u.lastLogin,
        lastPortalLogin: lastPortalLoginAt,
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
