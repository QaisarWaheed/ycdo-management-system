import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  LeaveApprovalAction,
  LeaveApprovalStage,
  LeaveStatus,
  LeaveType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAnyRole } from '../../common/user-roles.util';
import { toPakistanDateOnly } from '../attendance/attendance-late.util';
import { LeaveService } from './leave.service';

export interface SpecialLeaveUser {
  id: string;
  roles: UserRole[];
  employeeId?: string | null;
}

/** HR roles that may enter a special leave for any employee. */
export const SPECIAL_LEAVE_HR_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
];

const OPEN: LeaveStatus[] = [LeaveStatus.HR_PENDING, LeaveStatus.CHAIRMAN_PENDING];

/**
 * Phase 2 Req 2. Employee (portal) or HR applies → HR Operations approves
 * (not final) → Chairman gives the final decision. Only then the working days
 * become ON_LEAVE with the type's pay % (weekly offs stay paid holidays) and
 * payroll recomputes. Special leave is outside the monthly / yearly quota.
 */
@Injectable()
export class SpecialLeaveService {
  constructor(
    private prisma: PrismaService,
    private leaveService: LeaveService,
  ) {}

  listTypes(includeInactive = false) {
    return this.prisma.specialLeaveType.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  createType(dto: { name: string; payPercent: number; maxDays?: number | null }) {
    return this.prisma.specialLeaveType.create({
      data: {
        name: dto.name.trim(),
        payPercent: dto.payPercent,
        maxDays: dto.maxDays ?? null,
      },
    });
  }

  async updateType(
    id: string,
    dto: { name?: string; payPercent?: number; maxDays?: number | null; isActive?: boolean },
  ) {
    await this.prisma.specialLeaveType.findUniqueOrThrow({ where: { id } });
    // Changing the % only affects new requests; existing ones keep their snapshot.
    return this.prisma.specialLeaveType.update({
      where: { id },
      data: { ...dto, name: dto.name?.trim() },
    });
  }

  async apply(
    dto: {
      employeeId: string;
      specialLeaveTypeId: string;
      startDate: string;
      endDate: string;
      reason: string;
    },
    user: SpecialLeaveUser,
  ) {
    const isHr = hasAnyRole(user.roles, SPECIAL_LEAVE_HR_ROLES);
    if (!isHr && dto.employeeId !== user.employeeId) {
      throw new ForbiddenException('You can only apply special leave for yourself');
    }
    const [employee, type] = await Promise.all([
      this.prisma.employee.findUnique({ where: { id: dto.employeeId } }),
      this.prisma.specialLeaveType.findUnique({ where: { id: dto.specialLeaveTypeId } }),
    ]);
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException('Employee is not active');
    }
    if (!type?.isActive) throw new BadRequestException('Special leave type not available');

    const startDate = toPakistanDateOnly(new Date(dto.startDate));
    const endDate = toPakistanDateOnly(new Date(dto.endDate));
    if (startDate > endDate) {
      throw new BadRequestException('Start date must be before or equal to end date');
    }
    // HR may enter a leave that already started (e.g. accident); employees apply ahead.
    if (!isHr && startDate < toPakistanDateOnly(new Date())) {
      throw new BadRequestException('Leave start date must be today or later');
    }
    const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
    if (type.maxDays != null && totalDays > type.maxDays) {
      throw new BadRequestException(`${type.name} can be at most ${type.maxDays} days`);
    }
    const overlapping = await this.prisma.leaveRecord.findFirst({
      where: {
        employeeId: dto.employeeId,
        status: {
          notIn: [LeaveStatus.REJECTED, LeaveStatus.CANCELLED, LeaveStatus.RELIEVER_REJECTED],
        },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { id: true },
    });
    if (overlapping) {
      throw new ConflictException('Leave dates overlap with an existing leave request');
    }

    return this.prisma.$transaction(async (tx) => {
      const leave = await tx.leaveRecord.create({
        data: {
          employeeId: dto.employeeId,
          leaveType: LeaveType.SPECIAL,
          specialLeaveTypeId: type.id,
          payPercent: type.payPercent,
          startDate,
          endDate,
          totalDays,
          reason: dto.reason.trim(),
          status: LeaveStatus.HR_PENDING,
          currentStage: LeaveApprovalStage.HR_OPERATIONS,
          requestedById: user.id,
        },
      });
      await this.notifyRole(
        tx,
        UserRole.HR_OPERATIONS_MANAGER,
        `${employee.fullName}: ${type.name} ${this.day(startDate)} to ${this.day(endDate)} awaits your approval`,
      );
      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'LEAVE_APPLIED',
          message: `Your ${type.name} request was submitted and is pending HR Operations approval`,
        },
      });
      return leave;
    });
  }

  /** Open requests, or one employee's full special-leave history. */
  find(employeeId?: string) {
    return this.prisma.leaveRecord.findMany({
      where: {
        leaveType: LeaveType.SPECIAL,
        ...(employeeId ? { employeeId } : { status: { in: OPEN } }),
      },
      orderBy: { startDate: employeeId ? 'desc' : 'asc' },
      include: {
        specialLeaveType: true,
        employee: {
          select: {
            fullName: true,
            employeeCode: true,
            currentBranch: { select: { name: true } },
          },
        },
        approvals: {
          include: { actionByUser: { select: { email: true } } },
          orderBy: { actionAt: 'asc' },
        },
      },
    });
  }

  async decide(id: string, approve: boolean, user: SpecialLeaveUser, notes?: string) {
    const leave = await this.prisma.leaveRecord.findUnique({
      where: { id },
      include: { employee: true, specialLeaveType: true },
    });
    if (!leave || leave.leaveType !== LeaveType.SPECIAL) {
      throw new NotFoundException('Special leave not found');
    }
    if (!OPEN.includes(leave.status)) {
      throw new BadRequestException('This leave is not awaiting approval');
    }
    const atChairman = leave.status === LeaveStatus.CHAIRMAN_PENDING;
    const reviewers = atChairman
      ? [UserRole.CHAIRMAN, UserRole.SUPER_ADMIN]
      : [UserRole.HR_OPERATIONS_MANAGER, UserRole.SUPER_ADMIN];
    if (!hasAnyRole(user.roles, reviewers)) {
      throw new ForbiddenException(
        atChairman
          ? 'Only the Chairman can give the final decision'
          : 'Only HR Operations can decide this leave first',
      );
    }

    const status = !approve
      ? LeaveStatus.REJECTED
      : atChairman
        ? LeaveStatus.APPROVED
        : LeaveStatus.CHAIRMAN_PENDING;
    const typeName = leave.specialLeaveType?.name ?? 'Special leave';
    const note = notes?.trim() || null;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.leaveApproval.create({
        data: {
          leaveId: id,
          stage: atChairman ? LeaveApprovalStage.CHAIRMAN : LeaveApprovalStage.HR_OPERATIONS,
          action: approve ? LeaveApprovalAction.APPROVED : LeaveApprovalAction.REJECTED,
          actionBy: user.id,
          notes: note,
        },
      });
      const updated = await tx.leaveRecord.update({
        where: { id },
        data: {
          status,
          ...(status === LeaveStatus.CHAIRMAN_PENDING
            ? { currentStage: LeaveApprovalStage.CHAIRMAN }
            : {}),
          ...(status === LeaveStatus.APPROVED ? { approvedBy: user.id } : {}),
        },
        include: { employee: true },
      });
      if (status === LeaveStatus.APPROVED) {
        await this.leaveService.markLeaveAttendance(tx, updated);
      }
      if (status === LeaveStatus.CHAIRMAN_PENDING) {
        await this.notifyRole(
          tx,
          UserRole.CHAIRMAN,
          `${leave.employee.fullName}: ${typeName} approved by HR Operations, awaits your final approval`,
        );
      }
      await tx.notification.create({
        data: {
          employeeId: leave.employeeId,
          type: status === LeaveStatus.REJECTED ? 'LEAVE_REJECTED' : 'LEAVE_APPROVED',
          message:
            status === LeaveStatus.REJECTED
              ? `Your ${typeName} was rejected.${note ? ` Reason: ${note}` : ''}`
              : status === LeaveStatus.APPROVED
                ? `Your ${typeName} has been finally approved by the Chairman`
                : `Your ${typeName} was approved by HR Operations and sent to the Chairman`,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: `SPECIAL_LEAVE_${status}`,
          entity: 'LeaveRecord',
          entityId: id,
          changes: { from: leave.status, to: status, note, payPercent: leave.payPercent },
        },
      });
      return updated;
    });

    if (result.status === LeaveStatus.APPROVED) {
      await this.leaveService.recomputePendingPayrollForLeave(result);
    }
    return result;
  }

  private async notifyRole(tx: Prisma.TransactionClient, role: UserRole, message: string) {
    const users = await tx.user.findMany({
      where: {
        isActive: true,
        employeeId: { not: null },
        OR: [{ role }, { additionalRoles: { some: { role } } }],
      },
      select: { employeeId: true },
    });
    for (const u of users) {
      await tx.notification.create({
        data: { employeeId: u.employeeId!, type: 'SPECIAL_LEAVE_PENDING', message },
      });
    }
  }

  private day(d: Date) {
    return d.toISOString().slice(0, 10);
  }
}
