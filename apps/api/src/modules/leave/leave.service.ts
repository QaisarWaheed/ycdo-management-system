import { formatBranchLabel } from '../../common/branch-display';
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
  LeaveApprovalAction,
  LeaveApprovalStage,
  LeaveStatus,
  LeaveType,
  Prisma,
  RelieverRequestStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { enforceBranchScope } from '../../common/branch-scope.util';
import { getHierarchyPriority } from '../../common/hierarchy.util';
import {
  ApplyLeaveDto,
  ApproveLeaveDto,
  HRAssignRelieverDto,
  EmergencyLeaveDto,
  LeaveQueryDto,
  RequestRelieverDto,
  RespondRelieverDto,
  UpdateLeaveStatusDto,
} from './leave.dto';

const MAX_LEAVES_PER_YEAR = 24;

const ACTIVE_LEAVE_STATUSES: LeaveStatus[] = [
  LeaveStatus.PENDING,
  LeaveStatus.BRANCH_APPROVED,
  LeaveStatus.DEPT_APPROVED,
  LeaveStatus.RELIEVER_PENDING,
  LeaveStatus.RELIEVER_CONFIRMED,
  LeaveStatus.HR_PENDING,
  LeaveStatus.APPROVED,
];

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
      include: { currentBranch: { select: { name: true, address: true } } },
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

    if (leaveType === LeaveType.REGULAR) {
      const hoursUntilStart =
        (startDate.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilStart < 48) {
        throw new BadRequestException(
          'Regular leave must be requested at least 48 hours in advance',
        );
      }
    }

    let totalDays: number;

    if (
      leaveType === LeaveType.SHORT_LEAVE ||
      leaveType === LeaveType.EMERGENCY
    ) {
      if (
        leaveType === LeaveType.SHORT_LEAVE &&
        startDate.getTime() !== endDate.getTime()
      ) {
        throw new BadRequestException('Short leave must be for a single day');
      }

      if (leaveType === LeaveType.SHORT_LEAVE) {
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
            status: { in: ACTIVE_LEAVE_STATUSES },
            startDate: { gte: monthStart, lte: monthEnd },
          },
        });

        if (shortLeaveCount >= 2) {
          throw new BadRequestException(
            'Maximum 2 short leaves allowed per month',
          );
        }
      }

      totalDays = leaveType === LeaveType.SHORT_LEAVE ? 0 : 1;
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
        status: { in: ACTIVE_LEAVE_STATUSES },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });

    if (overlapping) {
      throw new ConflictException(
        'Leave dates overlap with an existing leave request',
      );
    }

    const employeeName = employee.fullName;

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
          currentStage: LeaveApprovalStage.BRANCH_MANAGER,
        },
      });

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'LEAVE_APPLIED',
          message:
            'Your leave request has been submitted and is pending Branch Manager approval',
        },
      });

      await this.notifyBranchManagers(
        tx,
        employee.currentBranchId,
        `${employeeName} has requested leave from ${this.formatDate(startDate)} to ${this.formatDate(endDate)}`,
        'LEAVE_PENDING_BRANCH',
      );

      return record;
    });

    return leave;
  }

  /** @deprecated Use branch/dept/hr approve endpoints instead */
  async updateStatus(
    leaveId: string,
    dto: UpdateLeaveStatusDto,
    actingUserId: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: actingUserId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.status === LeaveStatus.APPROVED) {
      return this.hrOperationsApprove(
        leaveId,
        { action: LeaveApprovalAction.APPROVED, notes: dto.approvedBy },
        { id: actingUserId, role: user.role },
      );
    }

    return this.hrOperationsApprove(
      leaveId,
      { action: LeaveApprovalAction.REJECTED, notes: dto.approvedBy },
      { id: actingUserId, role: user.role },
    );
  }

  async branchManagerApprove(
    leaveId: string,
    dto: ApproveLeaveDto,
    actingUser: ActingUser,
  ) {
    if (
      actingUser.role !== UserRole.ADMIN_MANAGER &&
      actingUser.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only Branch Manager can approve at this stage',
      );
    }

    const leave = await this.getLeaveWithEmployee(leaveId);

    if (leave.status !== LeaveStatus.PENDING) {
      throw new BadRequestException('Leave is not pending Branch Manager approval');
    }

    const employeeName = leave.employee.fullName;

    return this.prisma.$transaction(async (tx) => {
      await tx.leaveApproval.create({
        data: {
          leaveId,
          stage: LeaveApprovalStage.BRANCH_MANAGER,
          action: dto.action,
          actionBy: actingUser.id,
          notes: dto.notes,
        },
      });

      if (dto.action === LeaveApprovalAction.APPROVED) {
        const updated = await tx.leaveRecord.update({
          where: { id: leaveId },
          data: {
            status: LeaveStatus.BRANCH_APPROVED,
            currentStage: LeaveApprovalStage.DEPARTMENT_INCHARGE,
            branchManagerId: actingUser.id,
          },
          include: this.leaveInclude(),
        });

        await this.notifyAdminOfficersInBranch(
          tx,
          leave.employee.currentBranchId,
          `${employeeName} leave approved by Branch Manager. Awaiting your approval.`,
          'LEAVE_PENDING_DEPT',
        );

        await tx.auditLog.create({
          data: {
            userId: actingUser.id,
            action: 'LEAVE_BRANCH_APPROVED',
            entity: 'LeaveRecord',
            entityId: leaveId,
          },
        });

        return updated;
      }

      const updated = await tx.leaveRecord.update({
        where: { id: leaveId },
        data: { status: LeaveStatus.REJECTED },
        include: this.leaveInclude(),
      });

      await tx.notification.create({
        data: {
          employeeId: leave.employeeId,
          type: 'LEAVE_REJECTED',
          message: 'Your leave request was rejected by Branch Manager',
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUser.id,
          action: 'LEAVE_BRANCH_REJECTED',
          entity: 'LeaveRecord',
          entityId: leaveId,
        },
      });

      return updated;
    });
  }

  async deptInchargeApprove(
    leaveId: string,
    dto: ApproveLeaveDto,
    actingUser: ActingUser,
  ) {
    if (
      actingUser.role !== UserRole.ADMIN_OFFICER &&
      actingUser.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only Department Incharge can approve at this stage',
      );
    }

    const leave = await this.getLeaveWithEmployee(leaveId);

    if (leave.status !== LeaveStatus.BRANCH_APPROVED) {
      throw new BadRequestException(
        'Leave is not pending Department Incharge approval',
      );
    }

    const employeeName = leave.employee.fullName;

    return this.prisma.$transaction(async (tx) => {
      await tx.leaveApproval.create({
        data: {
          leaveId,
          stage: LeaveApprovalStage.DEPARTMENT_INCHARGE,
          action: dto.action,
          actionBy: actingUser.id,
          notes: dto.notes,
        },
      });

      if (dto.action === LeaveApprovalAction.APPROVED) {
        const updated = await tx.leaveRecord.update({
          where: { id: leaveId },
          data: {
            status: LeaveStatus.DEPT_APPROVED,
            currentStage: LeaveApprovalStage.DEPARTMENT_INCHARGE,
            deptInchargeId: actingUser.id,
          },
          include: this.leaveInclude(),
        });

        await tx.notification.create({
          data: {
            employeeId: leave.employeeId,
            type: 'SELECT_RELIEVER',
            message:
              'Your leave approved by Department Incharge. Please select a reliever.',
          },
        });

        await this.notifyHrOperations(
          tx,
          `${employeeName} leave approved by Dept Incharge. Awaiting reliever assignment then your final approval.`,
          'LEAVE_PENDING_HR',
        );

        return updated;
      }

      const updated = await tx.leaveRecord.update({
        where: { id: leaveId },
        data: { status: LeaveStatus.REJECTED },
        include: this.leaveInclude(),
      });

      await tx.notification.create({
        data: {
          employeeId: leave.employeeId,
          type: 'LEAVE_REJECTED',
          message: 'Leave rejected by Department Incharge',
        },
      });

      return updated;
    });
  }

  async hrOperationsApprove(
    leaveId: string,
    dto: ApproveLeaveDto,
    actingUser: ActingUser,
  ) {
    if (
      actingUser.role !== UserRole.HR_OPERATIONS_MANAGER &&
      actingUser.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only HR Operations Manager can give final approval',
      );
    }

    const leave = await this.getLeaveWithEmployee(leaveId);

    if (
      leave.status !== LeaveStatus.RELIEVER_CONFIRMED &&
      leave.status !== LeaveStatus.DEPT_APPROVED &&
      leave.status !== LeaveStatus.HR_PENDING
    ) {
      throw new BadRequestException(
        'Leave is not ready for HR Operations approval',
      );
    }

    const actingUserRecord = await this.prisma.user.findUnique({
      where: { id: actingUser.id },
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.leaveApproval.create({
        data: {
          leaveId,
          stage: LeaveApprovalStage.HR_OPERATIONS,
          action: dto.action,
          actionBy: actingUser.id,
          notes: dto.notes,
        },
      });

      if (dto.action === LeaveApprovalAction.APPROVED) {
        const updated = await tx.leaveRecord.update({
          where: { id: leaveId },
          data: {
            status: LeaveStatus.APPROVED,
            currentStage: LeaveApprovalStage.HR_OPERATIONS,
            approvedBy: actingUser.id,
          },
          include: {
            employee: true,
            relieverRequest: true,
          },
        });

        await this.markLeaveAttendance(tx, updated);

        await tx.auditLog.create({
          data: {
            userId: actingUser.id,
            action: 'LEAVE_HR_APPROVED',
            entity: 'LeaveRecord',
            entityId: leaveId,
          },
        });

        await tx.notification.create({
          data: {
            employeeId: leave.employeeId,
            type: 'LEAVE_APPROVED',
            message: `Your leave has been approved by HR Operations. Approved by: ${actingUserRecord?.email ?? 'HR Operations'}`,
          },
        });

        return updated;
      }

      const updated = await tx.leaveRecord.update({
        where: { id: leaveId },
        data: { status: LeaveStatus.REJECTED },
        include: this.leaveInclude(),
      });

      await tx.notification.create({
        data: {
          employeeId: leave.employeeId,
          type: 'LEAVE_REJECTED',
          message: `Your leave was rejected by HR Operations.${dto.notes ? ` Reason: ${dto.notes}` : ''}`,
        },
      });

      return updated;
    });
  }

  async getLeaveWithApprovals(leaveId: string) {
    const leave = await this.prisma.leaveRecord.findUnique({
      where: { id: leaveId },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            currentBranchId: true,
            currentDepartmentId: true,
            currentBranch: { select: { id: true, name: true, address: true } },
            currentDepartment: { select: { id: true, name: true } },
          },
        },
        approvals: {
          include: {
            actionByUser: { select: { id: true, email: true, role: true } },
          },
          orderBy: { actionAt: 'asc' },
        },
        relieverRequest: {
          include: {
            reliever: {
              select: {
                fullName: true,
                employeeCode: true,
              },
            },
          },
        },
      },
    });

    if (!leave) {
      throw new NotFoundException(`Leave record with id ${leaveId} not found`);
    }

    return leave;
  }

  findAll(
    query: LeaveQueryDto,
    actingUser?: { role: UserRole | string; branchId?: string | null },
  ) {
    enforceBranchScope(query, actingUser);

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

    if (query.branchId) {
      where.employee = { currentBranchId: query.branchId };
    }

    if (query.currentStage) {
      where.currentStage = query.currentStage as LeaveApprovalStage;
    }

    if (query.pendingForRole) {
      switch (query.pendingForRole) {
        case UserRole.ADMIN_MANAGER:
          where.status = LeaveStatus.PENDING;
          where.currentStage = LeaveApprovalStage.BRANCH_MANAGER;
          break;
        case UserRole.ADMIN_OFFICER:
          where.status = LeaveStatus.BRANCH_APPROVED;
          where.currentStage = LeaveApprovalStage.DEPARTMENT_INCHARGE;
          break;
        case UserRole.HR_OPERATIONS_MANAGER:
          where.status = {
            in: [
              LeaveStatus.RELIEVER_CONFIRMED,
              LeaveStatus.DEPT_APPROVED,
              LeaveStatus.HR_PENDING,
            ],
          };
          break;
        default:
          break;
      }
    }

    return this.prisma.leaveRecord.findMany({
      where,
      include: this.leaveInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyPendingReliever(employeeId: string) {
    return this.prisma.leaveRecord.findMany({
      where: {
        employeeId,
        status: LeaveStatus.DEPT_APPROVED,
        relieverRequest: { is: null },
      },
      include: this.leaveInclude(),
      orderBy: { startDate: 'asc' },
    });
  }

  async markEmergencyLeave(dto: EmergencyLeaveDto, actingUser: ActingUser) {
    const allowedRoles: UserRole[] = [
      UserRole.HR_MANAGER,
      UserRole.HR_ADMIN_MANAGER,
      UserRole.HR_OPERATIONS_MANAGER,
      UserRole.SUPER_ADMIN,
    ];

    if (!allowedRoles.includes(actingUser.role)) {
      throw new ForbiddenException('Not authorized to mark emergency leave');
    }

    if (!dto.emergencyReason?.trim()) {
      throw new BadRequestException('Emergency reason is required');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    const startDate = this.toDateOnly(new Date(dto.startDate));
    const endDate = this.toDateOnly(new Date(dto.endDate));

    if (startDate > endDate) {
      throw new BadRequestException('Start date must be before or equal to end date');
    }

    const totalDays = this.calculateTotalDays(startDate, endDate);

    const leave = await this.prisma.$transaction(async (tx) => {
      const record = await tx.leaveRecord.create({
        data: {
          employeeId: dto.employeeId,
          leaveType: LeaveType.EMERGENCY,
          startDate,
          endDate,
          totalDays,
          reason: dto.emergencyReason,
          status: LeaveStatus.APPROVED,
          currentStage: null,
        },
        include: { employee: true },
      });

      await this.markLeaveAttendance(tx, record);

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'EMERGENCY_LEAVE',
          message: `Emergency leave has been marked by HR for ${this.formatDate(startDate)} to ${this.formatDate(endDate)}. Reason: ${dto.emergencyReason}`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUser.id,
          action: 'EMERGENCY_LEAVE',
          entity: 'LeaveRecord',
          entityId: record.id,
        },
      });

      return record;
    });

    return leave;
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
            fullName: true,
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
        { fullName: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const candidates = await this.prisma.employee.findMany({
      where,
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        currentDesignation: true,
        shift: {
          select: { id: true, name: true, startTime: true, endTime: true },
        },
      },
    });

    return candidates
      .sort((a, b) => {
        const aPriority = getHierarchyPriority(a.currentDesignation);
        const bPriority = getHierarchyPriority(b.currentDesignation);
        if (aPriority !== bPriority) return aPriority - bPriority;
        return a.fullName.localeCompare(b.fullName);
      })
      .slice(0, 20);
  }

  async findOne(leaveId: string) {
    const leave = await this.prisma.leaveRecord.findUnique({
      where: { id: leaveId },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
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
      UserRole.ADMIN_MANAGER,
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

    await this.prisma.leaveRecord.update({
      where: { id: leaveId },
      data: { status: LeaveStatus.CANCELLED },
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

    if (leaveRecord.status !== LeaveStatus.DEPT_APPROVED) {
      throw new BadRequestException(
        'Reliever can only be requested after Department Incharge approval',
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

    const requesterName = leaveRecord.employee.fullName;

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

    const employeeName = relieverRequest.requestedBy.fullName;
    const relieverName = relieverRequest.reliever.fullName;

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
          data: {
            status: LeaveStatus.RELIEVER_CONFIRMED,
            currentStage: LeaveApprovalStage.HR_OPERATIONS,
          },
        });

        await this.notifyHrOperations(
          tx,
          `${employeeName} leave request has a confirmed reliever (${relieverName}). Please review and approve.`,
          'RELIEVER_CONFIRMED',
        );

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
      leaveRecord.status !== LeaveStatus.DEPT_APPROVED
    ) {
      throw new BadRequestException(
        'HR can only assign relievers for dept-approved or reliever-rejected leave',
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

    const employeeName = leaveRecord.employee.fullName;

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
        data: {
          status: LeaveStatus.RELIEVER_CONFIRMED,
          currentStage: LeaveApprovalStage.HR_OPERATIONS,
        },
      });

      await tx.notification.create({
        data: {
          employeeId: dto.relieverId,
          type: 'HR_RELIEVER_ASSIGNED',
          message: `HR has assigned you as reliever for ${employeeName} from ${this.formatDate(leaveRecord.startDate)} to ${this.formatDate(leaveRecord.endDate)}. This is mandatory.`,
        },
      });

      await this.notifyHrOperations(
        tx,
        `${employeeName} has an HR-assigned reliever (${reliever.fullName}). Awaiting final HR Operations approval.`,
        'HR_RELIEVER_ASSIGNED',
      );

      const approved = await tx.leaveRecord.findUnique({
        where: { id: leaveId },
        include: this.leaveInclude(),
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'HR_RELIEVER_ASSIGNED',
          entity: 'LeaveRecord',
          entityId: leaveId,
          changes: {
            relieverId: dto.relieverId,
          },
        },
      });

      return approved;
    });
  }

  async getTodayRelievers(branchId?: string) {
    const today = this.toDateOnly(new Date());

    const leaves = await this.prisma.leaveRecord.findMany({
      where: {
        status: LeaveStatus.APPROVED,
        startDate: { lte: today },
        endDate: { gte: today },
        ...(branchId
          ? { employee: { currentBranchId: branchId } }
          : {}),
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
            id: true,
            fullName: true,
            employeeCode: true,
            currentDesignation: true,
            currentBranch: { select: { name: true, address: true } },
            currentDepartment: { select: { name: true } },
          },
        },
        relieverRequest: {
          include: {
            reliever: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                currentBranch: { select: { name: true, address: true } },
                currentDepartment: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { startDate: 'asc' },
    });

    leaves.sort((a, b) => {
      const aPriority = getHierarchyPriority(a.employee.currentDesignation);
      const bPriority = getHierarchyPriority(b.employee.currentDesignation);
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.employee.fullName.localeCompare(b.employee.fullName);
    });

    return leaves.map((leave) => ({
      employee: {
        id: leave.employeeId,
        name: leave.employee.fullName,
        code: leave.employee.employeeCode,
        designation: leave.employee.currentDesignation,
        fullName: leave.employee.fullName,
        branch: formatBranchLabel(leave.employee.currentBranch),
        department: leave.employee.currentDepartment?.name ?? null,
      },
      reliever: leave.relieverRequest
        ? {
            id: leave.relieverRequest.relieverId,
            name: leave.relieverRequest.reliever.fullName,
            code: leave.relieverRequest.reliever.employeeCode,
            branch: formatBranchLabel(
              leave.relieverRequest.reliever.currentBranch,
            ),
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

  private leaveInclude() {
    return {
      employee: {
        select: {
          fullName: true,
          employeeCode: true,
          currentBranchId: true,
          currentDepartmentId: true,
          currentBranch: { select: { id: true, name: true, address: true } },
          currentDepartment: { select: { name: true } },
        },
      },
      approvals: {
        include: {
          actionByUser: { select: { id: true, email: true, role: true } },
        },
        orderBy: { actionAt: 'asc' as const },
      },
      relieverRequest: {
        include: {
          reliever: {
            select: {
              fullName: true,
              employeeCode: true,
            },
          },
        },
      },
    };
  }

  private async getLeaveWithEmployee(leaveId: string) {
    const leave = await this.prisma.leaveRecord.findUnique({
      where: { id: leaveId },
      include: { employee: true },
    });

    if (!leave) {
      throw new NotFoundException(`Leave record with id ${leaveId} not found`);
    }

    return leave;
  }

  private async notifyBranchManagers(
    tx: Prisma.TransactionClient,
    branchId: string,
    message: string,
    type: string,
  ) {
    await this.notifyUsersByRoleInBranch(
      tx,
      branchId,
      [UserRole.ADMIN_MANAGER],
      message,
      type,
    );
  }

  private async notifyAdminOfficersInBranch(
    tx: Prisma.TransactionClient,
    branchId: string,
    message: string,
    type: string,
  ) {
    await this.notifyUsersByRoleInBranch(
      tx,
      branchId,
      [UserRole.ADMIN_OFFICER],
      message,
      type,
    );
  }

  private async notifyHrOperations(
    tx: Prisma.TransactionClient,
    message: string,
    type: string,
  ) {
    const hrUsers = await tx.user.findMany({
      where: {
        role: UserRole.HR_OPERATIONS_MANAGER,
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

  private async notifyUsersByRoleInBranch(
    tx: Prisma.TransactionClient,
    branchId: string,
    roles: UserRole[],
    message: string,
    type: string,
  ) {
    const users = await tx.user.findMany({
      where: {
        role: { in: roles },
        isActive: true,
        employeeId: { not: null },
        employee: { currentBranchId: branchId },
      },
    });

    for (const user of users) {
      await tx.notification.create({
        data: {
          employeeId: user.employeeId!,
          message,
          type,
        },
      });
    }
  }
}
