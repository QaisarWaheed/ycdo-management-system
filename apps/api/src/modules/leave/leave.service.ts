import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceSource,
  AttendanceStatus,
  EmployeeStatus,
  LeaveStatus,
  LeaveType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApplyLeaveDto,
  LeaveQueryDto,
  UpdateLeaveStatusDto,
} from './leave.dto';

const MAX_LEAVES_PER_YEAR = 24;

interface ActingUser {
  id: string;
  role: UserRole;
  employeeId?: string | null;
}

@Injectable()
export class LeaveService {
  constructor(private prisma: PrismaService) {}

  async apply(dto: ApplyLeaveDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException('Employee is not active');
    }

    const startDate = this.toDateOnly(new Date(dto.startDate));
    const endDate = this.toDateOnly(new Date(dto.endDate));
    const today = this.toDateOnly(new Date());
    const leaveType = dto.leaveType ?? LeaveType.REGULAR;

    if (startDate < today) {
      throw new BadRequestException('Leave start date must be today or later');
    }

    if (startDate > endDate) {
      throw new BadRequestException('Start date must be before or equal to end date');
    }

    let totalDays: number;

    if (leaveType === LeaveType.SHORT_LEAVE) {
      if (startDate.getTime() !== endDate.getTime()) {
        throw new BadRequestException('Short leave must be for a single day');
      }

      const monthStart = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        1,
      );
      const monthEnd = new Date(
        startDate.getFullYear(),
        startDate.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );

      const shortLeaveCount = await this.prisma.leaveRecord.count({
        where: {
          employeeId: dto.employeeId,
          leaveType: LeaveType.SHORT_LEAVE,
          status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
          startDate: { gte: monthStart, lte: monthEnd },
        },
      });

      if (shortLeaveCount >= 2) {
        throw new BadRequestException(
          'Maximum 2 short leaves allowed per month',
        );
      }

      totalDays = 0;
    } else {
      totalDays = this.calculateTotalDays(startDate, endDate);
      const year = startDate.getFullYear();
      const approvedDays = await this.getApprovedDays(dto.employeeId, year);
      const remaining = MAX_LEAVES_PER_YEAR - approvedDays;

      if (approvedDays + totalDays > MAX_LEAVES_PER_YEAR) {
        throw new BadRequestException(
          `Leave limit exceeded. Remaining: ${remaining} days`,
        );
      }
    }

    const overlapping = await this.prisma.leaveRecord.findFirst({
      where: {
        employeeId: dto.employeeId,
        status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });

    if (overlapping) {
      throw new ConflictException(
        'Leave dates overlap with an existing leave request',
      );
    }

    const leave = await this.prisma.$transaction(async (tx) => {
      const record = await tx.leaveRecord.create({
        data: {
          employeeId: dto.employeeId,
          leaveType,
          startDate,
          endDate,
          totalDays,
          reason: dto.reason,
          status: LeaveStatus.PENDING,
        },
      });

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'LEAVE_APPLIED',
          message:
            'Your leave request has been submitted and is pending approval',
        },
      });

      return record;
    });

    return leave;
  }

  async updateStatus(
    leaveId: string,
    dto: UpdateLeaveStatusDto,
    actingUserId: string,
  ) {
    const leave = await this.prisma.leaveRecord.findUnique({
      where: { id: leaveId },
      include: { employee: true },
    });

    if (!leave) {
      throw new NotFoundException(`Leave record with id ${leaveId} not found`);
    }

    if (leave.status !== LeaveStatus.PENDING) {
      throw new BadRequestException(
        `Leave is already ${leave.status.toLowerCase()}`,
      );
    }

    if (dto.status === LeaveStatus.APPROVED) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.leaveRecord.update({
          where: { id: leaveId },
          data: {
            status: LeaveStatus.APPROVED,
            approvedBy: dto.approvedBy,
          },
        });

        const leaveDays = this.getDateRange(leave.startDate, leave.endDate);

        if (leave.leaveType === LeaveType.SHORT_LEAVE) {
          await tx.attendanceLog.upsert({
            where: {
              employeeId_date: {
                employeeId: leave.employeeId,
                date: leave.startDate,
              },
            },
            create: {
              employeeId: leave.employeeId,
              branchId: leave.employee.currentBranchId,
              date: leave.startDate,
              status: AttendanceStatus.HALF_DAY,
              source: AttendanceSource.MANUAL,
              note: 'Approved short leave',
            },
            update: {
              status: AttendanceStatus.HALF_DAY,
              source: AttendanceSource.MANUAL,
              note: 'Approved short leave',
            },
          });
        } else {
          for (const day of leaveDays) {
            await tx.attendanceLog.upsert({
              where: {
                employeeId_date: {
                  employeeId: leave.employeeId,
                  date: day,
                },
              },
              create: {
                employeeId: leave.employeeId,
                branchId: leave.employee.currentBranchId,
                date: day,
                status: AttendanceStatus.ON_LEAVE,
                source: AttendanceSource.MANUAL,
                note: 'Approved leave',
              },
              update: {
                status: AttendanceStatus.ON_LEAVE,
                source: AttendanceSource.MANUAL,
                note: 'Approved leave',
              },
            });
          }
        }

        await tx.notification.create({
          data: {
            employeeId: leave.employeeId,
            type: 'LEAVE_APPROVED',
            message: `Your leave request from ${this.formatDate(leave.startDate)} to ${this.formatDate(leave.endDate)} has been approved`,
          },
        });

        await tx.auditLog.create({
          data: {
            userId: actingUserId,
            action: 'LEAVE_APPROVED',
            entity: 'LeaveRecord',
            entityId: leaveId,
          },
        });

        return updated;
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.leaveRecord.update({
        where: { id: leaveId },
        data: {
          status: LeaveStatus.REJECTED,
          approvedBy: dto.approvedBy,
        },
      });

      await tx.notification.create({
        data: {
          employeeId: leave.employeeId,
          type: 'LEAVE_REJECTED',
          message: `Your leave request from ${this.formatDate(leave.startDate)} to ${this.formatDate(leave.endDate)} has been rejected`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'LEAVE_REJECTED',
          entity: 'LeaveRecord',
          entityId: leaveId,
        },
      });

      return updated;
    });
  }

  findAll(query: LeaveQueryDto) {
    const year = query.year ?? new Date().getFullYear();
    const where: Prisma.LeaveRecordWhereInput = {
      startDate: {
        gte: new Date(year, 0, 1),
        lte: new Date(year, 11, 31, 23, 59, 59, 999),
      },
    };

    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.month) {
      where.startDate = {
        gte: new Date(year, query.month - 1, 1),
        lte: new Date(year, query.month, 0, 23, 59, 59, 999),
      };
    }

    return this.prisma.leaveRecord.findMany({
      where,
      include: {
        employee: {
          select: { firstName: true, lastName: true, employeeCode: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(leaveId: string) {
    const leave = await this.prisma.leaveRecord.findUnique({
      where: { id: leaveId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            currentBranchId: true,
            currentDepartmentId: true,
          },
        },
      },
    });

    if (!leave) {
      throw new NotFoundException(`Leave record with id ${leaveId} not found`);
    }

    return leave;
  }

  async getLeaveBalance(employeeId: string, year?: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${employeeId} not found`,
      );
    }

    const targetYear = year ?? new Date().getFullYear();
    const approvedDays = await this.getApprovedDays(employeeId, targetYear);

    const pending = await this.prisma.leaveRecord.count({
      where: {
        employeeId,
        status: LeaveStatus.PENDING,
        startDate: {
          gte: new Date(targetYear, 0, 1),
          lte: new Date(targetYear, 11, 31, 23, 59, 59, 999),
        },
      },
    });

    return {
      employeeId,
      year: targetYear,
      totalAllowed: MAX_LEAVES_PER_YEAR,
      taken: approvedDays,
      remaining: MAX_LEAVES_PER_YEAR - approvedDays,
      pending,
    };
  }

  async cancel(leaveId: string, actingUser: ActingUser) {
    const leave = await this.prisma.leaveRecord.findUnique({
      where: { id: leaveId },
    });

    if (!leave) {
      throw new NotFoundException(`Leave record with id ${leaveId} not found`);
    }

    const hrRoles: UserRole[] = [
      UserRole.SUPER_ADMIN,
      UserRole.HR_MANAGER,
      UserRole.BRANCH_MANAGER,
    ];

    if (
      !hrRoles.includes(actingUser.role) &&
      leave.employeeId !== actingUser.employeeId
    ) {
      throw new ForbiddenException(
        'You can only cancel your own leave requests',
      );
    }

    if (leave.status !== LeaveStatus.PENDING) {
      throw new BadRequestException(
        'Only pending leave requests can be cancelled',
      );
    }

    await this.prisma.leaveRecord.delete({
      where: { id: leaveId },
    });

    return { message: 'Leave request cancelled successfully' };
  }

  private async getApprovedDays(
    employeeId: string,
    year: number,
  ): Promise<number> {
    const result = await this.prisma.leaveRecord.aggregate({
      where: {
        employeeId,
        leaveType: { not: LeaveType.SHORT_LEAVE },
        status: LeaveStatus.APPROVED,
        startDate: {
          gte: new Date(year, 0, 1),
          lte: new Date(year, 11, 31, 23, 59, 59, 999),
        },
      },
      _sum: { totalDays: true },
    });

    return result._sum.totalDays ?? 0;
  }

  private calculateTotalDays(startDate: Date, endDate: Date): number {
    const msPerDay = 1000 * 60 * 60 * 24;
    const diff = endDate.getTime() - startDate.getTime();
    return Math.floor(diff / msPerDay) + 1;
  }

  private getDateRange(startDate: Date, endDate: Date): Date[] {
    const dates: Date[] = [];
    const current = this.toDateOnly(startDate);
    const end = this.toDateOnly(endDate);

    while (current <= end) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }

  private toDateOnly(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
