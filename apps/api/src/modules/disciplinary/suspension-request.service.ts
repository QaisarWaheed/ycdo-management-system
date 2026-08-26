import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DisciplinaryStatus,
  DisciplinaryType,
  LetterStatus,
  LetterType,
  Permission,
  Prisma,
  SuspensionRequestStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAnyRole } from '../../common/user-roles.util';
import { AccessScopeService } from '../permissions/access-scope.service';
import { LettersService } from '../letters/letters.service';

export const SUSPENSION_PREPARE_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.ADMIN_MANAGER,
];

export const SUSPENSION_APPROVER_ROLES: UserRole[] = [
  UserRole.FOUNDER,
  UserRole.PRESIDENT,
  UserRole.CHAIRMAN,
  UserRole.ADMIN_MANAGER,
];

const EDITABLE_REQUEST_STATUSES: SuspensionRequestStatus[] = [
  SuspensionRequestStatus.DRAFT,
  SuspensionRequestStatus.REJECTED,
];

const BLOCKING_REQUEST_STATUSES: SuspensionRequestStatus[] = [
  SuspensionRequestStatus.PENDING_APPROVAL,
  SuspensionRequestStatus.APPROVED,
  SuspensionRequestStatus.ISSUED,
  SuspensionRequestStatus.COMPLETED,
  SuspensionRequestStatus.CANCELLED,
];

const PRE_RESOLUTION_ACTION_STATUSES: DisciplinaryStatus[] = [
  DisciplinaryStatus.OPEN,
  DisciplinaryStatus.UNDER_INQUIRY,
];

const REQUEST_INCLUDE = {
  letter: {
    select: {
      id: true,
      letterType: true,
      status: true,
      letterNo: true,
      fileUrl: true,
    },
  },
  employee: {
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      status: true,
      currentBranch: { select: { id: true, name: true, abbreviation: true } },
    },
  },
  selectedApprover: {
    select: {
      id: true,
      role: true,
      email: true,
      employee: { select: { fullName: true } },
    },
  },
  inquiryOfficer: {
    select: {
      id: true,
      role: true,
      email: true,
      employee: { select: { fullName: true } },
    },
  },
  submittedBy: {
    select: {
      id: true,
      email: true,
      employeeId: true,
      employee: { select: { fullName: true } },
    },
  },
  disciplinaryAction: {
    select: { id: true, type: true, status: true, reason: true },
  },
} as const;

type PrepareFields = {
  reason: string;
  periodStart: Date;
  periodEnd: Date;
  inquiryOfficerUserId: string;
  inquiryDeadlineAt: Date;
  selectedApproverUserId: string;
};

@Injectable()
export class SuspensionRequestService {
  constructor(
    private prisma: PrismaService,
    private lettersService: LettersService,
    private accessScopeService: AccessScopeService,
  ) {}

  async listEligibleApprovers() {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: { in: SUSPENSION_APPROVER_ROLES } },
          {
            additionalRoles: {
              some: { role: { in: SUSPENSION_APPROVER_ROLES } },
            },
          },
        ],
      },
      select: {
        id: true,
        role: true,
        email: true,
        employee: { select: { fullName: true, employeeCode: true } },
        additionalRoles: { select: { role: true } },
      },
      orderBy: { email: 'asc' },
    });

    return users.map((user) => {
      const effective = this.effectiveRoles(user.role, user.additionalRoles);
      const eligibleRole =
        SUSPENSION_APPROVER_ROLES.find((role) => effective.includes(role)) ??
        user.role;
      return {
        id: user.id,
        displayName: user.employee?.fullName ?? user.email,
        employeeCode: user.employee?.employeeCode ?? null,
        eligibleRole,
      };
    });
  }

  async listInquiryOfficerCandidates() {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        role: true,
        email: true,
        employee: { select: { fullName: true, employeeCode: true } },
      },
      orderBy: { email: 'asc' },
    });

    return users.map((user) => ({
      id: user.id,
      displayName: user.employee?.fullName ?? user.email,
      employeeCode: user.employee?.employeeCode ?? null,
      role: user.role,
    }));
  }

  async prepare(
    actionId: string,
    dto: PrepareFields & { reason: string },
    actingUserId: string,
    actingRole: UserRole,
    actingRoles?: UserRole[],
  ) {
    this.assertPrepareRole(actingRole, actingRoles);
    const fields = this.normalizeProposal(dto);

    const action = await this.loadActionForPrepare(actionId);
    await this.accessScopeService.assertEmployeeAccess(
      actingUserId,
      actingRole,
      Permission.DISCIPLINARY_MANAGE,
      action.employeeId,
    );

    await this.assertInquiryOfficer(fields.inquiryOfficerUserId);
    await this.assertEligibleApprover(fields.selectedApproverUserId);

    const existing = action.suspensionRequest;
    if (existing) {
      if (BLOCKING_REQUEST_STATUSES.includes(existing.status)) {
        throw new BadRequestException(
          `A suspension request already exists for this case (${existing.status}).`,
        );
      }
      return this.applyProposal(
        existing.id,
        fields,
        actingUserId,
        actingRole,
        {
          auditAction: 'SUSPENSION_REQUEST_PREPARED',
        },
      );
    }

    const letter = await this.resolveDraftLetter(
      action.id,
      action.employeeId,
      fields,
      actingUserId,
      actingRole,
    );

    try {
      const created = await this.prisma.suspensionRequest.create({
        data: {
          disciplinaryActionId: action.id,
          letterId: letter.id,
          employeeId: action.employeeId,
          status: SuspensionRequestStatus.DRAFT,
          reason: fields.reason,
          periodStart: fields.periodStart,
          periodEnd: fields.periodEnd,
          inquiryOfficerUserId: fields.inquiryOfficerUserId,
          inquiryDeadlineAt: fields.inquiryDeadlineAt,
          selectedApproverUserId: fields.selectedApproverUserId,
        },
        include: REQUEST_INCLUDE,
      });

      await this.prisma.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'SUSPENSION_REQUEST_PREPARED',
          entity: 'SuspensionRequest',
          entityId: created.id,
          changes: {
            disciplinaryActionId: action.id,
            letterId: letter.id,
            status: SuspensionRequestStatus.DRAFT,
          },
        },
      });

      return created;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.suspensionRequest.findUnique({
          where: { disciplinaryActionId: action.id },
          include: REQUEST_INCLUDE,
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  async findOne(id: string) {
    const request = await this.prisma.suspensionRequest.findUnique({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    if (!request) {
      throw new NotFoundException(`Suspension request with id ${id} not found`);
    }
    return request;
  }

  async updateDraft(
    id: string,
    dto: Partial<PrepareFields>,
    actingUserId: string,
    actingRole: UserRole,
    actingRoles?: UserRole[],
  ) {
    this.assertPrepareRole(actingRole, actingRoles);
    const current = await this.findOne(id);
    await this.accessScopeService.assertEmployeeAccess(
      actingUserId,
      actingRole,
      Permission.DISCIPLINARY_MANAGE,
      current.employeeId,
    );

    if (!EDITABLE_REQUEST_STATUSES.includes(current.status)) {
      throw new BadRequestException(
        'Only draft or rejected suspension requests can be updated',
      );
    }

    const fields = this.normalizeProposal({
      reason: dto.reason ?? current.reason,
      periodStart: dto.periodStart ?? current.periodStart,
      periodEnd: dto.periodEnd ?? current.periodEnd,
      inquiryOfficerUserId:
        dto.inquiryOfficerUserId ?? current.inquiryOfficerUserId,
      inquiryDeadlineAt: dto.inquiryDeadlineAt ?? current.inquiryDeadlineAt,
      selectedApproverUserId:
        dto.selectedApproverUserId ?? current.selectedApproverUserId,
    });

    await this.assertInquiryOfficer(fields.inquiryOfficerUserId);
    await this.assertEligibleApprover(fields.selectedApproverUserId);

    return this.applyProposal(id, fields, actingUserId, actingRole, {
      auditAction: 'SUSPENSION_REQUEST_UPDATED',
    });
  }

  async submit(
    id: string,
    actingUserId: string,
    actingRole: UserRole,
    actingRoles?: UserRole[],
  ) {
    this.assertPrepareRole(actingRole, actingRoles);
    const current = await this.findOne(id);
    await this.accessScopeService.assertEmployeeAccess(
      actingUserId,
      actingRole,
      Permission.DISCIPLINARY_MANAGE,
      current.employeeId,
    );

    if (current.status === SuspensionRequestStatus.PENDING_APPROVAL) {
      return { ...current, alreadySubmitted: true };
    }

    if (!EDITABLE_REQUEST_STATUSES.includes(current.status)) {
      throw new BadRequestException(
        `Cannot submit a suspension request in status ${current.status}`,
      );
    }

    this.normalizeProposal({
      reason: current.reason,
      periodStart: current.periodStart,
      periodEnd: current.periodEnd,
      inquiryOfficerUserId: current.inquiryOfficerUserId,
      inquiryDeadlineAt: current.inquiryDeadlineAt,
      selectedApproverUserId: current.selectedApproverUserId,
    });

    await this.assertInquiryOfficer(current.inquiryOfficerUserId);
    await this.assertEligibleApprover(current.selectedApproverUserId);
    await this.assertLinkedLetterSendable(current.letterId);
    await this.loadActionForPrepare(current.disciplinaryActionId);

    const submittedAt = new Date();
    const updated = await this.prisma.suspensionRequest.update({
      where: { id },
      data: {
        status: SuspensionRequestStatus.PENDING_APPROVAL,
        submittedById: actingUserId,
        submittedAt,
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
      },
      include: REQUEST_INCLUDE,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actingUserId,
        action: 'SUSPENSION_REQUEST_SUBMITTED',
        entity: 'SuspensionRequest',
        entityId: id,
        changes: {
          from: current.status,
          to: SuspensionRequestStatus.PENDING_APPROVAL,
          selectedApproverUserId: current.selectedApproverUserId,
          previousDecidedById: current.decidedById,
          previousDecisionNote: current.decisionNote,
        },
      },
    });

    return { ...updated, alreadySubmitted: false };
  }

  async listMyPending(actingUserId: string) {
    const requests = await this.prisma.suspensionRequest.findMany({
      where: {
        selectedApproverUserId: actingUserId,
        status: SuspensionRequestStatus.PENDING_APPROVAL,
      },
      include: REQUEST_INCLUDE,
      orderBy: { submittedAt: 'asc' },
    });

    return requests.map((request) => this.withDuration(request));
  }

  async findOneForApprover(id: string, actingUserId: string) {
    const request = await this.findOne(id);
    this.assertSelectedApprover(request.selectedApproverUserId, actingUserId);
    return this.withDuration(request);
  }

  async approve(id: string, actingUserId: string, note?: string) {
    return this.decide(id, actingUserId, {
      nextStatus: SuspensionRequestStatus.APPROVED,
      auditAction: 'SUSPENSION_REQUEST_APPROVED',
      notificationType: 'SUSPENSION_REQUEST_APPROVED',
      decisionNote: note?.trim() ? note.trim() : null,
      notifyMessage: 'Your suspension request was approved. The letter is not issued until HR sends it.',
    });
  }

  async reject(id: string, actingUserId: string, reason: string) {
    const decisionNote = reason?.trim();
    if (!decisionNote) {
      throw new BadRequestException('A rejection reason is required');
    }
    return this.decide(id, actingUserId, {
      nextStatus: SuspensionRequestStatus.REJECTED,
      auditAction: 'SUSPENSION_REQUEST_REJECTED',
      notificationType: 'SUSPENSION_REQUEST_REJECTED',
      decisionNote,
      notifyMessage: `Your suspension request was rejected: ${decisionNote}`,
    });
  }

  async getAssignedLetterPdf(id: string, actingUserId: string) {
    const request = await this.findOneForApprover(id, actingUserId);
    return this.lettersService.getPdf(request.letterId);
  }

  private withDuration<T extends { periodStart: Date; periodEnd: Date }>(
    request: T,
  ) {
    const durationDays =
      Math.round(
        (request.periodEnd.getTime() - request.periodStart.getTime()) /
          (24 * 60 * 60 * 1000),
      ) + 1;
    return { ...request, durationDays };
  }

  private assertSelectedApprover(
    selectedApproverUserId: string,
    actingUserId: string,
  ) {
    if (selectedApproverUserId !== actingUserId) {
      throw new ForbiddenException(
        'Only the selected approver can review or decide this suspension request',
      );
    }
  }

  private async assertActorIsActive(actingUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: actingUserId },
      select: { id: true, isActive: true },
    });
    if (!user) {
      throw new ForbiddenException('Approver account was not found');
    }
    if (!user.isActive) {
      throw new ForbiddenException('Approver account is inactive');
    }
  }

  private async decide(
    id: string,
    actingUserId: string,
    opts: {
      nextStatus:
        | typeof SuspensionRequestStatus.APPROVED
        | typeof SuspensionRequestStatus.REJECTED;
      auditAction: string;
      notificationType: string;
      decisionNote: string | null;
      notifyMessage: string;
    },
  ) {
    await this.assertActorIsActive(actingUserId);
    const current = await this.findOne(id);
    this.assertSelectedApprover(current.selectedApproverUserId, actingUserId);

    if (current.status !== SuspensionRequestStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        `Cannot decide a suspension request in status ${current.status}`,
      );
    }

    this.normalizeProposal({
      reason: current.reason,
      periodStart: current.periodStart,
      periodEnd: current.periodEnd,
      inquiryOfficerUserId: current.inquiryOfficerUserId,
      inquiryDeadlineAt: current.inquiryDeadlineAt,
      selectedApproverUserId: current.selectedApproverUserId,
    });
    await this.assertLinkedLetterSendable(current.letterId);
    await this.loadActionForPrepare(current.disciplinaryActionId);

    const decidedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.suspensionRequest.updateMany({
        where: {
          id,
          status: SuspensionRequestStatus.PENDING_APPROVAL,
          selectedApproverUserId: actingUserId,
        },
        data: {
          status: opts.nextStatus,
          decidedById: actingUserId,
          decidedAt,
          decisionNote: opts.decisionNote,
        },
      });
      if (result.count !== 1) {
        throw new BadRequestException(
          'This suspension request has already been decided',
        );
      }

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: opts.auditAction,
          entity: 'SuspensionRequest',
          entityId: id,
          changes: {
            from: SuspensionRequestStatus.PENDING_APPROVAL,
            to: opts.nextStatus,
            employeeId: current.employeeId,
            disciplinaryActionId: current.disciplinaryActionId,
            approverUserId: actingUserId,
            decisionNote: opts.decisionNote,
          },
        },
      });
    });

    await this.notifyEmployeeIfLinked(
      current.submittedById,
      opts.notificationType,
      opts.notifyMessage,
    );

    return this.withDuration(await this.findOne(id));
  }

  private async notifyEmployeeIfLinked(
    userId: string | null,
    type: string,
    message: string,
  ) {
    if (!userId) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { employeeId: true },
    });
    if (!user?.employeeId) return;
    await this.prisma.notification.create({
      data: {
        employeeId: user.employeeId,
        type,
        message,
      },
    });
  }

  private assertPrepareRole(actingRole: UserRole, actingRoles?: UserRole[]) {
    const effective = actingRoles?.length ? actingRoles : [actingRole];
    if (!hasAnyRole(effective, SUSPENSION_PREPARE_ROLES)) {
      throw new ForbiddenException(
        'Only Super Admin, HR Manager, or Admin Manager can prepare or submit a suspension request',
      );
    }
  }

  private normalizeProposal(input: {
    reason: string;
    periodStart: Date | string;
    periodEnd: Date | string;
    inquiryOfficerUserId: string;
    inquiryDeadlineAt: Date | string;
    selectedApproverUserId: string;
  }): PrepareFields {
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Suspension reason is required');
    }
    const periodStart = this.parseDate(input.periodStart, 'periodStart');
    const periodEnd = this.parseDate(input.periodEnd, 'periodEnd');
    const inquiryDeadlineAt = this.parseDate(
      input.inquiryDeadlineAt,
      'inquiryDeadlineAt',
    );
    if (periodEnd.getTime() < periodStart.getTime()) {
      throw new BadRequestException(
        'Suspension period end must be on or after the start date',
      );
    }
    return {
      reason,
      periodStart,
      periodEnd,
      inquiryOfficerUserId: input.inquiryOfficerUserId,
      inquiryDeadlineAt,
      selectedApproverUserId: input.selectedApproverUserId,
    };
  }

  private parseDate(value: Date | string, field: string): Date {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid ${field}`);
    }
    return date;
  }

  private async loadActionForPrepare(actionId: string) {
    const action = await this.prisma.disciplinaryAction.findUnique({
      where: { id: actionId },
      include: { suspensionRequest: true, employee: { select: { status: true } } },
    });
    if (!action) {
      throw new NotFoundException(
        `Disciplinary action with id ${actionId} not found`,
      );
    }
    if (action.type !== DisciplinaryType.SUSPENSION) {
      throw new BadRequestException(
        'Suspension requests can only be prepared for SUSPENSION disciplinary cases',
      );
    }
    if (!PRE_RESOLUTION_ACTION_STATUSES.includes(action.status)) {
      throw new BadRequestException(
        'Suspension can only be prepared for an open or under-inquiry case',
      );
    }
    return action;
  }

  private async assertInquiryOfficer(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true },
    });
    if (!user) {
      throw new BadRequestException('Inquiry officer not found');
    }
    if (!user.isActive) {
      throw new BadRequestException('Inquiry officer must be an active user');
    }
  }

  private async assertEligibleApprover(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        role: true,
        additionalRoles: { select: { role: true } },
      },
    });
    if (!user) {
      throw new BadRequestException('Selected approver not found');
    }
    if (!user.isActive) {
      throw new BadRequestException('Selected approver must be an active user');
    }
    const effective = this.effectiveRoles(user.role, user.additionalRoles);
    if (!hasAnyRole(effective, SUSPENSION_APPROVER_ROLES)) {
      throw new BadRequestException(
        'Selected approver must hold Founder, President, Chairman, or Admin Manager',
      );
    }
  }

  private effectiveRoles(
    primary: UserRole,
    additional: Array<{ role: UserRole }>,
  ): UserRole[] {
    return [primary, ...additional.map((row) => row.role)];
  }

  private async resolveDraftLetter(
    actionId: string,
    employeeId: string,
    fields: PrepareFields,
    actingUserId: string,
    actingRole: UserRole,
  ) {
    const extraFields = await this.buildLetterExtraFields(actionId, fields);
    const stamped = await this.findStampedDraftLetter(actionId, employeeId);
    if (stamped) {
      const updated = await this.lettersService.updateLetter(
        stamped.id,
        { extraFields },
        actingUserId,
        actingRole,
      );
      return updated.letter;
    }

    const generated = await this.lettersService.generate(
      {
        employeeId,
        letterType: LetterType.SUSPENSION,
        extraFields,
      },
      actingUserId,
      actingRole,
    );
    return generated.letter;
  }

  private async findStampedDraftLetter(actionId: string, employeeId: string) {
    const candidates = await this.prisma.letter.findMany({
      where: {
        employeeId,
        letterType: LetterType.SUSPENSION,
        status: LetterStatus.DRAFT,
        suspensionRequest: null,
      },
      select: { id: true, content: true, variables: true, generatedAt: true },
      orderBy: { generatedAt: 'asc' },
    });

    const matches = candidates.filter((letter) => {
      const content = (letter.content ?? {}) as Record<string, unknown>;
      const variables = (letter.variables ?? {}) as Record<string, unknown>;
      return (
        content.disciplinaryActionId === actionId ||
        variables.disciplinaryActionId === actionId
      );
    });

    return matches[0] ?? null;
  }

  private async applyProposal(
    id: string,
    fields: PrepareFields,
    actingUserId: string,
    actingRole: UserRole,
    opts: { auditAction: string },
  ) {
    const current = await this.findOne(id);
    await this.lettersService.updateLetter(
      current.letterId,
      {
        extraFields: await this.buildLetterExtraFields(
          current.disciplinaryActionId,
          fields,
        ),
      },
      actingUserId,
      actingRole,
    );

    const updated = await this.prisma.suspensionRequest.update({
      where: { id },
      data: {
        reason: fields.reason,
        periodStart: fields.periodStart,
        periodEnd: fields.periodEnd,
        inquiryOfficerUserId: fields.inquiryOfficerUserId,
        inquiryDeadlineAt: fields.inquiryDeadlineAt,
        selectedApproverUserId: fields.selectedApproverUserId,
      },
      include: REQUEST_INCLUDE,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actingUserId,
        action: opts.auditAction,
        entity: 'SuspensionRequest',
        entityId: id,
        changes: {
          status: updated.status,
          selectedApproverUserId: fields.selectedApproverUserId,
        },
      },
    });

    return updated;
  }

  private async buildLetterExtraFields(actionId: string, fields: PrepareFields) {
    const officer = await this.prisma.user.findUnique({
      where: { id: fields.inquiryOfficerUserId },
      select: {
        email: true,
        employee: { select: { fullName: true } },
      },
    });
    const durationDays =
      Math.round(
        (fields.periodEnd.getTime() - fields.periodStart.getTime()) /
          (24 * 60 * 60 * 1000),
      ) + 1;

    return {
      disciplinaryActionId: actionId,
      suspensionReason: fields.reason,
      suspensionStartDate: this.formatDate(fields.periodStart),
      suspensionEndDate: this.formatDate(fields.periodEnd),
      suspensionDuration: `${durationDays} day(s)`,
      inquiryOfficerName: officer?.employee?.fullName ?? officer?.email ?? '',
      inquiryDeadlineDate: this.formatDate(fields.inquiryDeadlineAt),
    };
  }

  private async assertLinkedLetterSendable(letterId: string) {
    const letter = await this.prisma.letter.findUnique({
      where: { id: letterId },
      select: { id: true, letterType: true, status: true },
    });
    if (!letter) {
      throw new BadRequestException('Linked suspension letter was not found');
    }
    if (letter.letterType !== LetterType.SUSPENSION) {
      throw new BadRequestException(
        'Linked letter must be a SUSPENSION letter',
      );
    }
    if (letter.status !== LetterStatus.DRAFT) {
      throw new BadRequestException(
        'Linked suspension letter must still be a DRAFT',
      );
    }
  }

  private formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
