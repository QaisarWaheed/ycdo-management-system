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
  RelieverRequestStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApplyLeaveDto,
  HRAssignRelieverDto,
  LeaveQueryDto,
  RequestRelieverDto,
  RespondRelieverDto,
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

    if (
      leave.status !== LeaveStatus.PENDING &&
      leave.status !== LeaveStatus.RELIEVER_CONFIRMED
    ) {
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
        relieverRequest: {
          include: {
            reliever: {
              select: {
                firstName: true,
                lastName: true,
                employeeCode: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getIncomingRelieverRequests(employeeId: string) {
    return this.prisma.relieverRequest.findMany({
      where: {
        relieverId: employeeId,
        status: RelieverRequestStatus.PENDING,
      },
      include: {
        requestedBy: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
          },
        },
        leaveRecord: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            totalDays: true,
            reason: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async getRelieverCandidates(search?: string) {
    const where: Prisma.EmployeeWhereInput = {
      status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] },
    };

    if (search?.trim()) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.employee.findMany({
      where,
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        shift: {
          select: { id: true, name: true, startTime: true, endTime: true },
        },
      },
      take: 20,
      orderBy: { firstName: 'asc' },
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

  async requestReliever(
    dto: RequestRelieverDto,
    requesterId: string,
    onBehalf = false,
  ) {
    const leaveRecord = await this.prisma.leaveRecord.findUnique({
      where: { id: dto.leaveRecordId },
      include: {
        employee: {
          include: { shift: true },
        },
        relieverRequest: true,
      },
    });

    if (!leaveRecord) {
      throw new NotFoundException(
        `Leave record with id ${dto.leaveRecordId} not found`,
      );
    }

    if (!onBehalf && leaveRecord.employeeId !== requesterId) {
      throw new ForbiddenException('You can only request relievers for your own leave');
    }

    if (leaveRecord.status !== LeaveStatus.PENDING) {
      throw new BadRequestException(
        'Reliever can only be requested for pending leave',
      );
    }

    if (leaveRecord.relieverRequest) {
      throw new ConflictException(
        'A reliever request already exists for this leave',
      );
    }

    if (dto.relieverId === requesterId) {
      throw new BadRequestException('You cannot assign yourself as reliever');
    }

    const reliever = await this.prisma.employee.findUnique({
      where: { id: dto.relieverId },
      include: { shift: true },
    });

    if (!reliever) {
      throw new NotFoundException(
        `Reliever employee with id ${dto.relieverId} not found`,
      );
    }

    if (
      reliever.status !== EmployeeStatus.ACTIVE &&
      reliever.status !== EmployeeStatus.APPOINTED
    ) {
      throw new BadRequestException('Selected reliever is not active');
    }

    this.assertShiftCompatible(leaveRecord.employee, reliever);

    const requesterName = `${leaveRecord.employee.firstName} ${leaveRecord.employee.lastName}`;

    const requestedById = onBehalf ? leaveRecord.employeeId : requesterId;

    return this.prisma.$transaction(async (tx) => {
      const relieverRequest = await tx.relieverRequest.create({
        data: {
          leaveRecordId: dto.leaveRecordId,
          requestedById,
          relieverId: dto.relieverId,
          status: RelieverRequestStatus.PENDING,
        },
      });

      await tx.leaveRecord.update({
        where: { id: dto.leaveRecordId },
        data: { status: LeaveStatus.RELIEVER_PENDING },
      });

      await tx.notification.create({
        data: {
          employeeId: dto.relieverId,
          type: 'RELIEVER_REQUEST',
          message: `${requesterName} has requested you to be their reliever for leave from ${this.formatDate(leaveRecord.startDate)} to ${this.formatDate(leaveRecord.endDate)}. You have 8 hours to respond.`,
        },
      });

      return relieverRequest;
    });
  }

  async respondToRelieverRequest(
    requestId: string,
    dto: RespondRelieverDto,
    responderId: string,
  ) {
    const relieverRequest = await this.prisma.relieverRequest.findUnique({
      where: { id: requestId },
      include: {
        leaveRecord: {
          include: { employee: true },
        },
        reliever: true,
        requestedBy: true,
      },
    });

    if (!relieverRequest) {
      throw new NotFoundException(
        `Reliever request with id ${requestId} not found`,
      );
    }

    if (relieverRequest.relieverId !== responderId) {
      throw new ForbiddenException('Only the assigned reliever can respond');
    }

    if (relieverRequest.status !== RelieverRequestStatus.PENDING) {
      throw new BadRequestException(
        `Reliever request is already ${relieverRequest.status.toLowerCase()}`,
      );
    }

    const employeeName = `${relieverRequest.requestedBy.firstName} ${relieverRequest.requestedBy.lastName}`;
    const relieverName = `${relieverRequest.reliever.firstName} ${relieverRequest.reliever.lastName}`;

    return this.prisma.$transaction(async (tx) => {
      if (dto.accept) {
        const updated = await tx.relieverRequest.update({
          where: { id: requestId },
          data: {
            status: RelieverRequestStatus.ACCEPTED,
            respondedAt: new Date(),
          },
        });

        await tx.leaveRecord.update({
          where: { id: relieverRequest.leaveRecordId },
          data: { status: LeaveStatus.RELIEVER_CONFIRMED },
        });

        await this.notifyHrRoles(tx, [UserRole.HR_MANAGER, UserRole.HR_ADMIN_MANAGER], `${employeeName} leave request has a confirmed reliever (${relieverName}). Please review and approve.`, 'RELIEVER_CONFIRMED');

        return updated;
      }

      const updated = await tx.relieverRequest.update({
        where: { id: requestId },
        data: {
          status: RelieverRequestStatus.REJECTED,
          respondedAt: new Date(),
        },
      });

      await tx.leaveRecord.update({
        where: { id: relieverRequest.leaveRecordId },
        data: { status: LeaveStatus.RELIEVER_REJECTED },
      });

      await this.notifyHrRoles(tx, [UserRole.HR_MANAGER], `${relieverName} rejected reliever request for ${employeeName}. Please assign a reliever manually.`, 'RELIEVER_REJECTED');

      return updated;
    });
  }

  async hrAssignReliever(
    leaveId: string,
    dto: HRAssignRelieverDto,
    actingUserId: string,
  ) {
    const leaveRecord = await this.prisma.leaveRecord.findUnique({
      where: { id: leaveId },
      include: {
        employee: { include: { shift: true } },
        relieverRequest: true,
      },
    });

    if (!leaveRecord) {
      throw new NotFoundException(`Leave record with id ${leaveId} not found`);
    }

    if (
      leaveRecord.status !== LeaveStatus.RELIEVER_REJECTED &&
      leaveRecord.status !== LeaveStatus.PENDING
    ) {
      throw new BadRequestException(
        'HR can only assign relievers for pending or reliever-rejected leave',
      );
    }

    const reliever = await this.prisma.employee.findUnique({
      where: { id: dto.relieverId },
      include: { shift: true },
    });

    if (!reliever) {
      throw new NotFoundException(
        `Reliever employee with id ${dto.relieverId} not found`,
      );
    }

    this.assertShiftCompatible(leaveRecord.employee, reliever);

    const employeeName = `${leaveRecord.employee.firstName} ${leaveRecord.employee.lastName}`;

    return this.prisma.$transaction(async (tx) => {
      if (leaveRecord.relieverRequest) {
        await tx.relieverRequest.update({
          where: { id: leaveRecord.relieverRequest.id },
          data: {
            relieverId: dto.relieverId,
            status: RelieverRequestStatus.HR_ASSIGNED,
            hrAssigned: true,
            hrAssignedBy: actingUserId,
            hrAssignedAt: new Date(),
          },
        });
      } else {
        await tx.relieverRequest.create({
          data: {
            leaveRecordId: leaveId,
            requestedById: leaveRecord.employeeId,
            relieverId: dto.relieverId,
            status: RelieverRequestStatus.HR_ASSIGNED,
            hrAssigned: true,
            hrAssignedBy: actingUserId,
            hrAssignedAt: new Date(),
          },
        });
      }

      await tx.leaveRecord.update({
        where: { id: leaveId },
        data: { status: LeaveStatus.RELIEVER_CONFIRMED },
      });

      await tx.notification.create({
        data: {
          employeeId: dto.relieverId,
          type: 'HR_RELIEVER_ASSIGNED',
          message: `HR has assigned you as reliever for ${employeeName} from ${this.formatDate(leaveRecord.startDate)} to ${this.formatDate(leaveRecord.endDate)}. This is mandatory.`,
        },
      });

      const approved = await tx.leaveRecord.update({
        where: { id: leaveId },
        data: {
          status: LeaveStatus.APPROVED,
          approvedBy: actingUserId,
        },
        include: {
          employee: true,
          relieverRequest: {
            include: {
              reliever: {
                select: {
                  firstName: true,
                  lastName: true,
                  employeeCode: true,
                  currentBranch: { select: { name: true } },
                  currentDepartment: { select: { name: true } },
                },
              },
            },
          },
        },
      });

      await this.markLeaveAttendance(tx, approved);

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'HR_RELIEVER_ASSIGNED',
          entity: 'LeaveRecord',
          entityId: leaveId,
          changes: {
            relieverId: dto.relieverId,
            autoApproved: true,
          },
        },
      });

      return approved;
    });
  }

  async getTodayRelievers() {
    const today = this.toDateOnly(new Date());

    const leaves = await this.prisma.leaveRecord.findMany({
      where: {
        status: LeaveStatus.APPROVED,
        startDate: { lte: today },
        endDate: { gte: today },
        relieverRequest: {
          status: {
            in: [
              RelieverRequestStatus.ACCEPTED,
              RelieverRequestStatus.HR_ASSIGNED,
            ],
          },
        },
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
            currentBranch: { select: { name: true } },
            currentDepartment: { select: { name: true } },
          },
        },
        relieverRequest: {
          include: {
            reliever: {
              select: {
                firstName: true,
                lastName: true,
                employeeCode: true,
                currentBranch: { select: { name: true } },
                currentDepartment: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { startDate: 'asc' },
    });

    return leaves.map((leave) => ({
      employee: {
        name: `${leave.employee.firstName} ${leave.employee.lastName}`,
        code: leave.employee.employeeCode,
        branch: leave.employee.currentBranch?.name ?? null,
        department: leave.employee.currentDepartment?.name ?? null,
      },
      reliever: leave.relieverRequest
        ? {
            name: `${leave.relieverRequest.reliever.firstName} ${leave.relieverRequest.reliever.lastName}`,
            code: leave.relieverRequest.reliever.employeeCode,
            branch: leave.relieverRequest.reliever.currentBranch?.name ?? null,
            department:
              leave.relieverRequest.reliever.currentDepartment?.name ?? null,
          }
        : null,
      leaveStartDate: leave.startDate,
      leaveEndDate: leave.endDate,
      relieverRequestStatus: leave.relieverRequest?.status ?? null,
    }));
  }

  private async markLeaveAttendance(
    tx: Prisma.TransactionClient,
    leave: {
      employeeId: string;
      startDate: Date;
      endDate: Date;
      leaveType: LeaveType;
      employee: { currentBranchId: string };
    },
  ) {
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
      return;
    }

    for (const day of this.getDateRange(leave.startDate, leave.endDate)) {
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

  private assertShiftCompatible(
    requester: { shift: { startTime: string; endTime: string } | null },
    reliever: { shift: { startTime: string; endTime: string } | null },
  ) {
    if (!requester.shift || !reliever.shift) {
      throw new BadRequestException(
        'Both employees must have assigned shifts for reliever validation',
      );
    }

    if (
      this.shiftsOverlap(
        requester.shift.startTime,
        requester.shift.endTime,
        reliever.shift.startTime,
        reliever.shift.endTime,
      )
    ) {
      throw new BadRequestException(
        'Selected employee has a conflicting shift and cannot serve as reliever',
      );
    }
  }

  private shiftsOverlap(
    requesterStart: string,
    requesterEnd: string,
    relieverStart: string,
    relieverEnd: string,
  ): boolean {
    let rStart = this.parseTimeToMinutes(requesterStart);
    let rEnd = this.parseTimeToMinutes(requesterEnd);
    let vStart = this.parseTimeToMinutes(relieverStart);
    let vEnd = this.parseTimeToMinutes(relieverEnd);

    if (rEnd <= rStart) {
      rEnd += 24 * 60;
    }
    if (vEnd <= vStart) {
      vEnd += 24 * 60;
    }

    return vStart < rEnd && vEnd > rStart;
  }

  private parseTimeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private async notifyHrRoles(
    tx: Prisma.TransactionClient,
    roles: UserRole[],
    message: string,
    type: string,
  ) {
    const hrUsers = await tx.user.findMany({
      where: {
        role: { in: roles },
        isActive: true,
        employeeId: { not: null },
      },
    });

    for (const hr of hrUsers) {
      await tx.notification.create({
        data: {
          employeeId: hr.employeeId!,
          message,
          type,
        },
      });
    }
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
