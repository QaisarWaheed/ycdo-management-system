import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsQueryDto } from './audit-logs.dto';

type ActingUser = {
  id: string;
  role: UserRole | string;
};

@Injectable()
export class AuditLogsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: AuditLogsQueryDto, actingUser: ActingUser) {
    const limit = query.limit ?? 20;
    const canViewAll = actingUser.role === UserRole.SUPER_ADMIN;

    const userId = canViewAll
      ? query.actingUserId
      : (query.actingUserId ?? actingUser.id);

    if (
      !canViewAll &&
      userId !== actingUser.id
    ) {
      throw new ForbiddenException('You can only view your own activity');
    }

    const where: Prisma.AuditLogWhereInput = {};
    if (userId) {
      where.userId = userId;
    }
    if (query.entity) {
      where.entity = query.entity;
    }

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, email: true, role: true } },
      },
    });

    const enriched = await Promise.all(
      logs.map(async (log) => ({
        ...log,
        description: await this.buildDescription(log),
        employeeName: await this.resolveEmployeeName(log),
      })),
    );

    return enriched;
  }

  private async resolveEmployeeName(log: {
    entity: string;
    entityId: string;
    changes?: Prisma.JsonValue;
  }): Promise<string | null> {
    if (log.entity === 'Employee') {
      const employee = await this.prisma.employee.findUnique({
        where: { id: log.entityId },
        select: { fullName: true },
      });
      return employee?.fullName ?? null;
    }

    if (log.entity === 'AttendanceLog') {
      const attendance = await this.prisma.attendanceLog.findUnique({
        where: { id: log.entityId },
        select: { employee: { select: { fullName: true } } },
      });
      return attendance?.employee?.fullName ?? null;
    }

    if (log.entity === 'LeaveRecord') {
      const leave = await this.prisma.leaveRecord.findUnique({
        where: { id: log.entityId },
        select: { employee: { select: { fullName: true } } },
      });
      return leave?.employee?.fullName ?? null;
    }

    const changes = log.changes as Record<string, unknown> | null;
    if (changes && typeof changes.fullName === 'string') {
      return changes.fullName;
    }

    return null;
  }

  private async buildDescription(log: {
    action: string;
    entity: string;
    entityId: string;
    changes?: Prisma.JsonValue;
  }): Promise<string> {
    const name =
      (await this.resolveEmployeeName(log)) ?? 'employee';

    switch (log.action) {
      case 'MANUAL_ATTENDANCE':
      case 'ATTENDANCE_MARKED':
        return `Marked ${name} attendance`;
      case 'ATTENDANCE_UPDATED':
        return `Updated ${name} attendance`;
      case 'LEAVE_BRANCH_APPROVED':
      case 'LEAVE_APPROVED':
        return `Approved leave for ${name}`;
      case 'LEAVE_BRANCH_REJECTED':
      case 'LEAVE_REJECTED':
        return `Rejected leave for ${name}`;
      case 'EMPLOYEE_CREATED':
        return `Added new employee ${name}`;
      case 'PAYROLL_STATUS_CHANGED':
        return `Updated payroll status for ${name}`;
      case 'SALARY_INCREMENT':
        return `Applied salary increment for ${name}`;
      case 'UPDATE_USER_PASSWORD':
        return 'Updated a user login password';
      case 'PASSWORD_RESET':
        return 'Reset a user password';
      default:
        return `${log.action.replace(/_/g, ' ').toLowerCase()} — ${name}`;
    }
  }
}
