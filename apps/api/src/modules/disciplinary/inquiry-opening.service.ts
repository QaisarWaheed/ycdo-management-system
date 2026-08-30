import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DisciplinaryStatus,
  DisciplinaryType,
  EmployeeStatus,
  InquiryOpenApprovalStatus,
  Permission,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAnyRole } from '../../common/user-roles.util';
import { AccessScopeService } from '../permissions/access-scope.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import {
  SUSPENSION_PREPARE_ROLES,
  SuspensionRequestService,
} from './suspension-request.service';
import {
  notifyInquiryApproverWhatsApp,
  notifyInquiryOfficerAssignedWhatsApp,
} from './inquiry-whatsapp';

const OPEN_INCLUDE = {
  inquiryOfficer: {
    select: {
      id: true,
      email: true,
      employee: {
        select: { fullName: true, phone: true, currentDesignation: true },
      },
    },
  },
  selectedOpenApprover: {
    select: {
      id: true,
      role: true,
      email: true,
      employee: { select: { fullName: true, phone: true } },
    },
  },
  disciplinaryAction: {
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          status: true,
          phone: true,
        },
      },
    },
  },
} as const;

export const INQUIRY_OPEN_SUBMIT_ROLES: UserRole[] = [
  ...SUSPENSION_PREPARE_ROLES,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
];

@Injectable()
export class InquiryOpeningService {
  constructor(
    private prisma: PrismaService,
    private accessScopeService: AccessScopeService,
    private suspensionRequestService: SuspensionRequestService,
    private whatsapp: WhatsAppService,
  ) {}

  async submitPendingOpen(
    input: {
      employeeId: string;
      reason: string;
      durationDays: number;
      inquiryOfficerUserId: string;
      selectedApproverUserId: string;
    },
    actingUserId: string,
    actingRole: UserRole,
    actingRoles?: UserRole[],
  ) {
    this.assertSubmitRole(actingRole, actingRoles);
    if (input.durationDays < 1 || input.durationDays > 30) {
      throw new BadRequestException('Inquiry duration must be between 1 and 30 days.');
    }

    await this.accessScopeService.assertEmployeeAccess(
      actingUserId,
      actingRole,
      Permission.DISCIPLINARY_MANAGE,
      input.employeeId,
    );

    const employee = await this.prisma.employee.findUnique({
      where: { id: input.employeeId },
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        status: true,
      },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with id ${input.employeeId} not found`);
    }
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException(
        'Due-for-suspension inquiries can only be started while the employee is still ACTIVE.',
      );
    }

    const existing = await this.prisma.disciplinaryAction.findFirst({
      where: {
        employeeId: input.employeeId,
        type: DisciplinaryType.SUSPENSION,
        status: {
          in: [DisciplinaryStatus.OPEN, DisciplinaryStatus.UNDER_INQUIRY],
        },
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(
        'This employee already has an open suspension / inquiry case.',
      );
    }

    await this.assertInquiryOfficer(input.inquiryOfficerUserId);
    await this.assertEligibleApprover(input.selectedApproverUserId);

    const now = new Date();
    const deadlineAt = this.addDays(now, input.durationDays);

    const inquiry = await this.prisma.$transaction(async (tx) => {
      const action = await tx.disciplinaryAction.create({
        data: {
          employeeId: input.employeeId,
          type: DisciplinaryType.SUSPENSION,
          reason: input.reason,
          issuedAt: now,
          status: DisciplinaryStatus.OPEN,
        },
      });

      const created = await tx.inquiry.create({
        data: {
          disciplinaryActionId: action.id,
          startedAt: now,
          deadlineAt,
          durationDays: input.durationDays,
          inquiryOfficerUserId: input.inquiryOfficerUserId,
          openApprovalStatus: InquiryOpenApprovalStatus.PENDING_APPROVAL,
          selectedOpenApproverUserId: input.selectedApproverUserId,
          openSubmittedById: actingUserId,
          openSubmittedAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'INQUIRY_OPEN_SUBMITTED',
          entity: 'Inquiry',
          entityId: created.id,
          changes: {
            employeeId: input.employeeId,
            durationDays: input.durationDays,
            inquiryOfficerUserId: input.inquiryOfficerUserId,
            selectedApproverUserId: input.selectedApproverUserId,
          },
        },
      });

      return created;
    });

    const loaded = await this.prisma.inquiry.findUnique({
      where: { id: inquiry.id },
      include: OPEN_INCLUDE,
    });
    if (!loaded) throw new NotFoundException('Inquiry not found after create');

    await notifyInquiryApproverWhatsApp(this.whatsapp, {
      kind: 'open',
      phone: loaded.selectedOpenApprover?.employee?.phone,
      approverName: loaded.selectedOpenApprover?.employee?.fullName,
      employeeName: employee.fullName,
      employeeCode: employee.employeeCode,
      reason: input.reason,
    });

    return loaded;
  }

  async listMyPending(actingUserId: string) {
    return this.prisma.inquiry.findMany({
      where: {
        selectedOpenApproverUserId: actingUserId,
        openApprovalStatus: InquiryOpenApprovalStatus.PENDING_APPROVAL,
        officiallyOpenedAt: null,
        closedAt: null,
      },
      include: OPEN_INCLUDE,
      orderBy: { openSubmittedAt: 'asc' },
    });
  }

  async approveOpen(inquiryId: string, actingUserId: string, note?: string) {
    const inquiry = await this.loadPendingOpen(inquiryId, actingUserId);
    const now = new Date();
    const days = inquiry.durationDays ?? 3;
    const deadlineAt = this.addDays(now, days);
    const employee = inquiry.disciplinaryAction.employee;

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.inquiry.updateMany({
        where: {
          id: inquiryId,
          openApprovalStatus: InquiryOpenApprovalStatus.PENDING_APPROVAL,
          officiallyOpenedAt: null,
          closedAt: null,
        },
        data: {
          openApprovalStatus: InquiryOpenApprovalStatus.APPROVED,
          officiallyOpenedAt: now,
          startedAt: now,
          deadlineAt,
          openDecidedById: actingUserId,
          openDecidedAt: now,
          openDecisionNote: note?.trim() || null,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This inquiry opening is no longer pending.');
      }

      await tx.disciplinaryAction.update({
        where: { id: inquiry.disciplinaryActionId },
        data: { status: DisciplinaryStatus.UNDER_INQUIRY },
      });

      await tx.employee.update({
        where: { id: employee.id },
        data: { status: EmployeeStatus.SUSPENDED },
      });

      await tx.notification.create({
        data: {
          employeeId: employee.id,
          type: 'INQUIRY_STARTED',
          message: `An inquiry has been opened. You are suspended until it is closed. Deadline: ${this.formatDate(deadlineAt)}`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'INQUIRY_OPEN_APPROVED',
          entity: 'Inquiry',
          entityId: inquiryId,
          changes: {
            employeeId: employee.id,
            status: EmployeeStatus.SUSPENDED,
            deadlineAt,
          },
        },
      });

      return tx.inquiry.findUnique({
        where: { id: inquiryId },
        include: OPEN_INCLUDE,
      });
    });

    const officer = updated?.inquiryOfficer;
    await notifyInquiryOfficerAssignedWhatsApp(this.whatsapp, {
      phone: officer?.employee?.phone,
      officerName: officer?.employee?.fullName,
      employeeName: employee.fullName,
      employeeCode: employee.employeeCode,
      startDate: this.formatDate(now),
      endDate: this.formatDate(deadlineAt),
      reason: inquiry.disciplinaryAction.reason,
    });

    return updated;
  }

  async rejectOpen(inquiryId: string, actingUserId: string, reason: string) {
    const note = reason.trim();
    if (!note) {
      throw new BadRequestException('Rejection reason is required.');
    }
    await this.loadPendingOpen(inquiryId, actingUserId);

    const claimed = await this.prisma.inquiry.updateMany({
      where: {
        id: inquiryId,
        openApprovalStatus: InquiryOpenApprovalStatus.PENDING_APPROVAL,
        officiallyOpenedAt: null,
        closedAt: null,
      },
      data: {
        openApprovalStatus: InquiryOpenApprovalStatus.REJECTED,
        openDecidedById: actingUserId,
        openDecidedAt: new Date(),
        openDecisionNote: note,
      },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('This inquiry opening is no longer pending.');
    }

    await this.prisma.auditLog.create({
      data: {
        userId: actingUserId,
        action: 'INQUIRY_OPEN_REJECTED',
        entity: 'Inquiry',
        entityId: inquiryId,
        changes: { reason: note },
      },
    });

    return this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      include: OPEN_INCLUDE,
    });
  }

  private async loadPendingOpen(inquiryId: string, actingUserId: string) {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      include: OPEN_INCLUDE,
    });
    if (!inquiry) throw new NotFoundException(`Inquiry with id ${inquiryId} not found`);
    if (inquiry.disciplinaryAction.type !== DisciplinaryType.SUSPENSION) {
      throw new BadRequestException('This workflow applies to SUSPENSION inquiries only.');
    }
    if (inquiry.selectedOpenApproverUserId !== actingUserId) {
      throw new ForbiddenException('This inquiry opening is not assigned to you.');
    }
    if (inquiry.openApprovalStatus !== InquiryOpenApprovalStatus.PENDING_APPROVAL) {
      throw new BadRequestException('This inquiry opening is not pending approval.');
    }
    return inquiry;
  }

  private async assertInquiryOfficer(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true },
    });
    if (!user?.isActive) {
      throw new BadRequestException('Inquiry officer must be an active user.');
    }
  }

  private async assertEligibleApprover(userId: string) {
    const eligible = await this.suspensionRequestService.listEligibleApprovers();
    if (!eligible.some((row) => row.id === userId)) {
      throw new BadRequestException(
        'Selected approver is not eligible to authorize opening this inquiry.',
      );
    }
  }

  private assertSubmitRole(actingRole: UserRole, actingRoles?: UserRole[]) {
    const roles = actingRoles?.length ? actingRoles : [actingRole];
    if (!hasAnyRole(roles, INQUIRY_OPEN_SUBMIT_ROLES)) {
      throw new ForbiddenException('You are not allowed to start this inquiry.');
    }
  }

  private addDays(from: Date, days: number) {
    const next = new Date(from);
    next.setDate(next.getDate() + days);
    return next;
  }

  private formatDate(value: Date) {
    return value.toLocaleDateString('en-GB');
  }
}
