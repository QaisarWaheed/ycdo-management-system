import { formatBranchLabel } from '../../common/branch-display';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceLogType,
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
import { dutyWindowsOverlap, getDutyWindow } from '../../common/duty.util';
import { is24HourShift } from '../attendance/attendance-biometric.util';
import { getHierarchyPriority } from '../../common/hierarchy.util';
import { AccessScopeService } from '../permissions/access-scope.service';
import {
  ApplyLeaveDto,
  ApproveLeaveDto,
  HRAssignRelieverDto,
  EmergencyLeaveDto,
  VerifiedLeaveDto,
  LeaveQueryDto,
  RequestRelieverDto,
  RespondRelieverDto,
  UpdateLeaveStatusDto,
} from './leave.dto';
import {
  assertEmployeeInMedicineScope,
  isMedicineManagerRole,
} from '../../common/medicine-scope.util';
import {
  applyExtraLeaveRejectedDeduction,
  reverseAbsenceDeductionForDate,
} from '../attendance/discipline.helper';
import {
  countApprovedFullLeaveOccurrencesThisMonth,
  countShortLeaveOccurrencesThisMonth,
  MONTHLY_FULL_LEAVE_LIMIT,
  MONTHLY_SHORT_LEAVE_LIMIT,
  reconcileShortLeaveAttendance,
} from '../attendance/short-leave.util';

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
  branchId?: string | null;
}

@Injectable()
export class LeaveService {
  constructor(
    private prisma: PrismaService,
    private accessScopeService: AccessScopeService,
  ) {}

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

      // 24-hour staff are completely out of scope for Short Leave — reject
      // here rather than letting the request run the full approval chain
      // only to silently fail to apply at final reconciliation.
      if (leaveType === LeaveType.SHORT_LEAVE && is24HourShift(employee)) {
        throw new BadRequestException(
          '24-hour staff are not eligible for Short Leave',
        );
      }

      // Monthly Short Leave quota (shared with the HR-emergency flow) is no
      // longer gated at request time — a request is always allowed to enter
      // the approval chain; the quota is checked once, uniformly, at final
      // HR approval (see hrOperationsApprove), which is also where a
      // quota-exceeding request is diverted to PENDING_APPROVAL instead of
      // being hard-rejected here.
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

      if (dto.relieverId) {
        if (dto.relieverId === dto.employeeId) {
          throw new BadRequestException(
            'Employee cannot be their own reliever',
          );
        }
        await this.assertRelieverEligible(
          tx,
          dto.relieverId,
          startDate,
          endDate,
        );
        await this.assertNoRelieverDoubleBooking(
          tx,
          dto.relieverId,
          employee,
          startDate,
          endDate,
        );
        await tx.relieverRequest.create({
          data: {
            leaveRecordId: record.id,
            requestedById: dto.employeeId,
            relieverId: dto.relieverId,
            status: RelieverRequestStatus.PENDING,
          },
        });
      }

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
        const withReliever = await tx.leaveRecord.findUnique({
          where: { id: leaveId },
          include: { relieverRequest: true },
        });

        if (withReliever?.relieverRequest) {
          const updated = await tx.leaveRecord.update({
            where: { id: leaveId },
            data: {
              status: LeaveStatus.RELIEVER_PENDING,
              currentStage: LeaveApprovalStage.DEPARTMENT_INCHARGE,
              deptInchargeId: actingUser.id,
            },
            include: this.leaveInclude(),
          });

          await tx.notification.create({
            data: {
              employeeId: withReliever.relieverRequest.relieverId,
              type: 'RELIEVER_REQUEST',
              message: `${employeeName} has requested you to be their reliever for leave from ${this.formatDate(leave.startDate)} to ${this.formatDate(leave.endDate)}. You have 8 hours to respond.`,
            },
          });

          await this.notifyHrOperations(
            tx,
            `${employeeName} leave approved by Dept Incharge. Preferred reliever notified.`,
            'LEAVE_PENDING_HR',
          );

          return updated;
        }

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
        // Monthly entitlement gate — a leave the chain has approved may
        // still exceed the employee's normal monthly Full Leave (2) or
        // Short Leave (3, shared with the HR-emergency flow) allowance.
        // When it does, it is diverted to PENDING_APPROVAL for a distinct
        // HR quota-exception decision instead of becoming APPROVED here.
        // An already-approved extra leave does not free up a new normal
        // slot — the count below only ever counts OTHER occurrences.
        const withinQuota =
          leave.leaveType === LeaveType.SHORT_LEAVE
            ? (await countShortLeaveOccurrencesThisMonth(
                tx,
                leave.employeeId,
                leave.startDate,
                leaveId,
              )) < MONTHLY_SHORT_LEAVE_LIMIT
            : (await countApprovedFullLeaveOccurrencesThisMonth(
                tx,
                leave.employeeId,
                leave.startDate,
                leaveId,
              )) < MONTHLY_FULL_LEAVE_LIMIT;

        if (!withinQuota) {
          const pending = await tx.leaveRecord.update({
            where: { id: leaveId },
            data: {
              status: LeaveStatus.PENDING_APPROVAL,
              currentStage: LeaveApprovalStage.HR_OPERATIONS,
            },
            include: this.leaveInclude(),
          });

          await tx.notification.create({
            data: {
              employeeId: leave.employeeId,
              type: 'LEAVE_PENDING_QUOTA_APPROVAL',
              message:
                'Your leave has cleared the normal approval chain but exceeds your monthly entitlement. It now requires a separate HR decision.',
            },
          });

          return pending;
        }

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

  /**
   * The distinct HR decision on a PENDING_APPROVAL (quota-exceeded) leave —
   * separate from hrOperationsApprove's normal chain-approval action so the
   * two meanings ("the chain approved this" vs "HR is granting/denying an
   * over-quota exception") stay unambiguous. Logged via the same
   * LeaveApproval audit trail, under LeaveApprovalStage.QUOTA_EXCEPTION.
   */
  async decideQuotaException(
    leaveId: string,
    dto: ApproveLeaveDto,
    actingUser: ActingUser,
  ) {
    if (
      actingUser.role !== UserRole.HR_OPERATIONS_MANAGER &&
      actingUser.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only HR Operations Manager can decide a quota exception',
      );
    }

    const leave = await this.getLeaveWithEmployee(leaveId);

    if (leave.status !== LeaveStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Leave is not pending a quota-exception decision',
      );
    }

    if (dto.action === LeaveApprovalAction.REJECTED && !dto.notes?.trim()) {
      throw new BadRequestException(
        'A rejection reason is required to reject a quota exception',
      );
    }

    const actingUserRecord = await this.prisma.user.findUnique({
      where: { id: actingUser.id },
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.leaveApproval.create({
        data: {
          leaveId,
          stage: LeaveApprovalStage.QUOTA_EXCEPTION,
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
            approvedBy: actingUser.id,
          },
          include: {
            employee: true,
            relieverRequest: true,
          },
        });

        // Treated exactly like a normal approval — for Short Leave this
        // still re-validates duration inside reconcileShortLeaveAttendance,
        // so a quota exception never bypasses the 2h/3h duration rule.
        await this.markLeaveAttendance(tx, updated);

        await tx.auditLog.create({
          data: {
            userId: actingUser.id,
            action: 'LEAVE_QUOTA_EXCEPTION_APPROVED',
            entity: 'LeaveRecord',
            entityId: leaveId,
          },
        });

        await tx.notification.create({
          data: {
            employeeId: leave.employeeId,
            type: 'LEAVE_APPROVED',
            message: `Your extra leave (beyond monthly entitlement) has been approved by HR Operations. Approved by: ${actingUserRecord?.email ?? 'HR Operations'}`,
          },
        });

        return updated;
      }

      const updated = await tx.leaveRecord.update({
        where: { id: leaveId },
        data: { status: LeaveStatus.REJECTED },
        include: this.leaveInclude(),
      });

      // No leave protection. Full Leave (REGULAR/EMERGENCY) gets the 1-day
      // deduction; Short Leave gets none — markLeaveAttendance/
      // reconcileShortLeaveAttendance was never called, so whatever
      // discipline already existed on the underlying date (from the
      // original biometric/manual classification) simply stands untouched.
      if (leave.leaveType !== LeaveType.SHORT_LEAVE) {
        await applyExtraLeaveRejectedDeduction(
          tx,
          leave.employeeId,
          leave.startDate,
        );
      }

      await tx.auditLog.create({
        data: {
          userId: actingUser.id,
          action: 'LEAVE_QUOTA_EXCEPTION_REJECTED',
          entity: 'LeaveRecord',
          entityId: leaveId,
        },
      });

      await tx.notification.create({
        data: {
          employeeId: leave.employeeId,
          type: 'LEAVE_REJECTED',
          message: `Your extra leave (beyond monthly entitlement) was rejected by HR Operations. Reason: ${dto.notes}`,
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

  /**
   * Monthly quota context for a PENDING_APPROVAL decision — how many OTHER
   * occurrences this employee already has this calendar month, and the
   * applicable limit. Read-only; reuses the exact same counters the quota
   * gate itself uses (hrOperationsApprove / markEmergencyLeave), so what HR
   * sees here always matches what actually gated this leave.
   */
  async getQuotaContext(leaveId: string) {
    const leave = await this.getLeaveWithEmployee(leaveId);

    const isShortLeave = leave.leaveType === LeaveType.SHORT_LEAVE;
    const monthlyOccurrenceCount = isShortLeave
      ? await countShortLeaveOccurrencesThisMonth(
          this.prisma,
          leave.employeeId,
          leave.startDate,
          leaveId,
        )
      : await countApprovedFullLeaveOccurrencesThisMonth(
          this.prisma,
          leave.employeeId,
          leave.startDate,
          leaveId,
        );

    return {
      leaveType: leave.leaveType,
      monthlyOccurrenceCount,
      monthlyLimit: isShortLeave
        ? MONTHLY_SHORT_LEAVE_LIMIT
        : MONTHLY_FULL_LEAVE_LIMIT,
    };
  }

  async findAll(
    query: LeaveQueryDto,
    actingUser?: {
      id?: string;
      role: UserRole | string;
      branchId?: string | null;
    },
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

    let employeeWhere: Prisma.EmployeeWhereInput = {};
    if (query.branchId) {
      employeeWhere.currentBranchId = query.branchId;
    }
    if (actingUser?.id) {
      employeeWhere =
        await this.accessScopeService.narrowEmployeeWhereForActor(
          actingUser.id,
          actingUser.role as UserRole,
          employeeWhere,
        );
    }
    if (Object.keys(employeeWhere).length > 0) {
      where.employee = employeeWhere;
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
      // Emergency Full Leave shares the SAME monthly quota as Portal Full
      // Leave (both count via countApprovedFullLeaveOccurrencesThisMonth,
      // which already treats REGULAR + EMERGENCY as one combined bucket).
      // Bypassing the chain does not bypass the entitlement — exceeding it
      // still requires a distinct HR quota-exception decision.
      const withinQuota =
        (await countApprovedFullLeaveOccurrencesThisMonth(
          tx,
          dto.employeeId,
          startDate,
        )) < MONTHLY_FULL_LEAVE_LIMIT;

      const record = await tx.leaveRecord.create({
        data: {
          employeeId: dto.employeeId,
          leaveType: LeaveType.EMERGENCY,
          startDate,
          endDate,
          totalDays,
          reason: dto.emergencyReason,
          status: withinQuota
            ? LeaveStatus.APPROVED
            : LeaveStatus.PENDING_APPROVAL,
          currentStage: null,
          approvedBy: withinQuota ? actingUser.id : null,
        },
        include: { employee: true },
      });

      if (withinQuota) {
        await this.markLeaveAttendance(tx, record);
      }

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: withinQuota
            ? 'EMERGENCY_LEAVE'
            : 'LEAVE_PENDING_QUOTA_APPROVAL',
          message: withinQuota
            ? `Emergency leave has been marked by HR for ${this.formatDate(startDate)} to ${this.formatDate(endDate)}. Reason: ${dto.emergencyReason}`
            : `Emergency leave for ${this.formatDate(startDate)} to ${this.formatDate(endDate)} exceeds your monthly Full Leave entitlement and now requires a separate HR decision.`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUser.id,
          action: withinQuota
            ? 'EMERGENCY_LEAVE'
            : 'EMERGENCY_LEAVE_PENDING_QUOTA',
          entity: 'LeaveRecord',
          entityId: record.id,
        },
      });

      return record;
    });

    return leave;
  }

  /**
   * Mark leave from Manual Attendance. Instantly APPROVED — no approval chain.
   * Also writes ON_LEAVE / HALF_DAY attendance for the date range.
   */
  async markVerifiedLeave(dto: VerifiedLeaveDto, actingUser: ActingUser) {
    const allowedRoles: UserRole[] = [
      UserRole.HR_MANAGER,
      UserRole.HR_ADMIN_MANAGER,
      UserRole.HR_OPERATIONS_MANAGER,
      UserRole.HR_EXECUTIVE,
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN_MANAGER,
      UserRole.ADMIN_OFFICER,
      UserRole.MEDICINE_MANAGER,
    ];

    if (!allowedRoles.includes(actingUser.role)) {
      throw new ForbiddenException('Not authorized to mark verified leave');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: { currentDepartment: { select: { name: true } } },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    if (
      employee.status !== EmployeeStatus.ACTIVE &&
      employee.status !== EmployeeStatus.APPOINTED
    ) {
      throw new BadRequestException('Employee is not active');
    }

    if (isMedicineManagerRole(actingUser.role)) {
      if (!assertEmployeeInMedicineScope(employee)) {
        throw new ForbiddenException(
          'You can only mark leave for Medicine Management System staff',
        );
      }
    }

    if (
      actingUser.role === UserRole.ADMIN_MANAGER &&
      actingUser.branchId &&
      employee.currentBranchId !== actingUser.branchId
    ) {
      throw new ForbiddenException(
        'You can only mark leave for employees in your branch',
      );
    }

    const startDate = this.toDateOnly(new Date(dto.startDate));
    const endDate = this.toDateOnly(new Date(dto.endDate));

    if (startDate > endDate) {
      throw new BadRequestException(
        'Start date must be before or equal to end date',
      );
    }

    if (
      dto.leaveType === LeaveType.SHORT_LEAVE &&
      startDate.getTime() !== endDate.getTime()
    ) {
      throw new BadRequestException('Short leave must be a single day');
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

    const totalDays =
      dto.leaveType === LeaveType.SHORT_LEAVE
        ? 0
        : this.calculateTotalDays(startDate, endDate);

    const leave = await this.prisma.$transaction(async (tx) => {
      const record = await tx.leaveRecord.create({
        data: {
          employeeId: dto.employeeId,
          leaveType: dto.leaveType,
          startDate,
          endDate,
          totalDays,
          reason: dto.reason.trim(),
          status: LeaveStatus.APPROVED,
          currentStage: null,
        },
        include: { employee: true },
      });

      await this.markLeaveAttendance(tx, record);

      if (dto.relieverId) {
        if (dto.relieverId === dto.employeeId) {
          throw new BadRequestException(
            'Employee cannot be their own reliever',
          );
        }
        await this.assertRelieverEligible(
          tx,
          dto.relieverId,
          startDate,
          endDate,
        );
        await this.assertNoRelieverDoubleBooking(
          tx,
          dto.relieverId,
          employee,
          startDate,
          endDate,
        );

        await tx.relieverRequest.create({
          data: {
            leaveRecordId: record.id,
            requestedById: dto.employeeId,
            relieverId: dto.relieverId,
            status: RelieverRequestStatus.HR_ASSIGNED,
            hrAssigned: true,
            hrAssignedBy: actingUser.id,
            hrAssignedAt: new Date(),
          },
        });

        await tx.notification.create({
          data: {
            employeeId: dto.relieverId,
            type: 'HR_RELIEVER_ASSIGNED',
            message: `You have been assigned as reliever for ${employee.fullName} from ${this.formatDate(startDate)} to ${this.formatDate(endDate)}.`,
          },
        });
      }

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'LEAVE_VERIFIED',
          message: `Leave has been marked and approved by attendance staff for ${this.formatDate(startDate)} to ${this.formatDate(endDate)}.`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUser.id,
          action: 'LEAVE_MARKED_VERIFIED',
          entity: 'LeaveRecord',
          entityId: record.id,
          changes: {
            leaveType: dto.leaveType,
            startDate: dto.startDate,
            endDate: dto.endDate,
            relieverId: dto.relieverId ?? null,
          },
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

    await this.assertRelieverEligible(
      this.prisma,
      dto.relieverId,
      leaveRecord.startDate,
      leaveRecord.endDate,
    );
    await this.assertNoRelieverDoubleBooking(
      this.prisma,
      dto.relieverId,
      leaveRecord.employee,
      leaveRecord.startDate,
      leaveRecord.endDate,
    );

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
      leaveRecord.status !== LeaveStatus.DEPT_APPROVED &&
      leaveRecord.status !== LeaveStatus.APPROVED
    ) {
      throw new BadRequestException(
        'HR can only assign relievers for dept-approved, approved, or reliever-rejected leave',
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

    await this.assertRelieverEligible(
      this.prisma,
      dto.relieverId,
      leaveRecord.startDate,
      leaveRecord.endDate,
    );
    await this.assertNoRelieverDoubleBooking(
      this.prisma,
      dto.relieverId,
      leaveRecord.employee,
      leaveRecord.startDate,
      leaveRecord.endDate,
      leaveId,
    );

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
        data:
          leaveRecord.status === LeaveStatus.APPROVED
            ? {}
            : {
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

      if (leaveRecord.status !== LeaveStatus.APPROVED) {
        await this.notifyHrOperations(
          tx,
          `${employeeName} has an HR-assigned reliever (${reliever.fullName}). Awaiting final HR Operations approval.`,
          'HR_RELIEVER_ASSIGNED',
        );
      }

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

  /**
   * Shared reliever eligibility gate — active status + not on their own
   * approved leave for the covered date range. Called from every reliever
   * assignment entry point (apply, markVerifiedLeave, requestReliever,
   * hrAssignReliever) so all four behave identically instead of each
   * re-implementing its own partial check.
   */
  private async assertRelieverEligible(
    db: Prisma.TransactionClient | PrismaService,
    relieverId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    const reliever = await db.employee.findUnique({
      where: { id: relieverId },
    });
    if (!reliever) {
      throw new NotFoundException('Selected reliever not found');
    }
    if (
      reliever.status !== EmployeeStatus.ACTIVE &&
      reliever.status !== EmployeeStatus.APPOINTED
    ) {
      throw new BadRequestException('Selected reliever is not active');
    }

    const ownLeaveConflict = await db.leaveRecord.findFirst({
      where: {
        employeeId: relieverId,
        status: LeaveStatus.APPROVED,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (ownLeaveConflict) {
      throw new ConflictException(
        'Selected reliever has approved leave covering this date range',
      );
    }
  }

  /**
   * Prevents assigning the same reliever to two covered employees whose own
   * duty windows overlap in clock time on an overlapping date range — they
   * cannot physically cover both at once. RelieverRequest itself carries no
   * time window, so the covered employees' duty windows (existing, reliable
   * data) are used as the best available proxy. A reliever with no duty
   * window on either side of the comparison cannot be evaluated and is not
   * blocked, so legitimate non-overlapping assignments are never rejected
   * just because duty times aren't configured.
   */
  private async assertNoRelieverDoubleBooking(
    db: Prisma.TransactionClient | PrismaService,
    relieverId: string,
    coveredEmployee: {
      dutyStartTime: string | null;
      dutyEndTime: string | null;
    },
    startDate: Date,
    endDate: Date,
    excludeLeaveRecordId?: string,
  ): Promise<void> {
    const newWin = getDutyWindow(coveredEmployee);
    if (!newWin) return;

    const existingAssignments = await db.relieverRequest.findMany({
      where: {
        relieverId,
        status: {
          in: [
            RelieverRequestStatus.ACCEPTED,
            RelieverRequestStatus.HR_ASSIGNED,
          ],
        },
        ...(excludeLeaveRecordId
          ? { leaveRecordId: { not: excludeLeaveRecordId } }
          : {}),
        leaveRecord: {
          status: LeaveStatus.APPROVED,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      },
      include: {
        leaveRecord: {
          include: {
            employee: { select: { dutyStartTime: true, dutyEndTime: true } },
          },
        },
      },
    });

    for (const assignment of existingAssignments) {
      const otherWin = getDutyWindow(assignment.leaveRecord.employee);
      if (!otherWin) continue;
      if (dutyWindowsOverlap(newWin, otherWin)) {
        throw new ConflictException(
          'Selected reliever is already covering another overlapping duty window on this date range',
        );
      }
    }
  }

  private async markLeaveAttendance(
    tx: Prisma.TransactionClient,
    leave: {
      employeeId: string;
      startDate: Date;
      endDate: Date;
      leaveType: LeaveType;
      employee: {
        currentBranchId: string;
        dutyStartTime: string | null;
        dutyEndTime: string | null;
        dutyTotalHours?: number | null;
        shift?: { name?: string | null; startTime: string; endTime: string } | null;
      };
    },
  ) {
    if (leave.leaveType === LeaveType.SHORT_LEAVE) {
      // Canonical reconciliation shared with the HR-emergency flow (see
      // attendance.service.ts) — validates duration against real
      // checkIn/checkOut when it already exists, writes AttendanceStatus
      // .SHORT_LEAVE (not HALF_DAY — the two flows now converge on the same
      // treatment), and reverses lateness discipline only when valid.
      // Silently no-ops on an invalid/unsupported case (e.g. a chain-
      // approved leave whose actual attendance turns out to exceed the
      // duration limit) — the leave itself still ends up APPROVED, but
      // without the Short Leave attendance/payroll benefit for that day.
      await reconcileShortLeaveAttendance(
        tx,
        leave.employeeId,
        leave.startDate,
        leave.employee,
      );
      return;
    }

    for (const day of this.getDateRange(leave.startDate, leave.endDate)) {
      const existing = await tx.attendanceLog.findUnique({
        where: {
          employeeId_date_type: {
            employeeId: leave.employeeId,
            date: day,
            type: AttendanceLogType.REGULAR,
          },
        },
      });

      // Reconcile only when the day being converted was actually an
      // auto-marked absence — never touches an already-ON_LEAVE row
      // (idempotent on reruns) or an unrelated status.
      if (
        existing &&
        (existing.status === AttendanceStatus.UNINFORMED_ABSENT ||
          existing.status === AttendanceStatus.ABSENT)
      ) {
        await reverseAbsenceDeductionForDate(tx, leave.employeeId, day);
      }

      await tx.attendanceLog.upsert({
        where: {
          employeeId_date_type: {
            employeeId: leave.employeeId,
            date: day,
            type: AttendanceLogType.REGULAR,
          },
        },
        create: {
          employeeId: leave.employeeId,
          branchId: leave.employee.currentBranchId,
          date: day,
          type: AttendanceLogType.REGULAR,
          status: AttendanceStatus.ON_LEAVE,
          source: AttendanceSource.MANUAL,
          note: 'Approved leave',
          dutyStartTimeSnapshot: leave.employee.dutyStartTime ?? null,
          dutyEndTimeSnapshot: leave.employee.dutyEndTime ?? null,
        },
        update: {
          status: AttendanceStatus.ON_LEAVE,
          source: AttendanceSource.MANUAL,
          note: 'Approved leave',
        },
      });
    }
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
