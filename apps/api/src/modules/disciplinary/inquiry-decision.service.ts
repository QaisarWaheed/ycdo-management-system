import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChangeType,
  DeductionType,
  DisciplinaryStatus,
  DisciplinaryType,
  EmployeeStatus,
  InquiryFinding,
  InquiryFinalAction,
  InquiryFinalDecisionStatus,
  InquiryOutcome,
  LetterStatus,
  LetterType,
  PayrollStatus,
  Prisma,
  SuspensionRequestStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAnyRole } from '../../common/user-roles.util';
import { LettersService } from '../letters/letters.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { suspensionInquiryReinstatementData } from '../attendance/suspension-watch-baseline.util';
import {
  SUSPENSION_PREPARE_ROLES,
  SuspensionRequestService,
} from './suspension-request.service';
import {
  expectedFinalLetters,
  ensureInquiryResolvedNotification,
  matchFinalLetterStatuses,
  restNotifiesOnApply,
  type ExpectedFinalLetter,
} from './inquiry-final-letters';
import {
  notifyInquiryApproverWhatsApp,
  notifyInquiryOfficerResultWhatsApp,
} from './inquiry-whatsapp';

const INQUIRY_INCLUDE = {
  inquiryOfficer: {
    select: {
      id: true,
      email: true,
      employee: {
        select: { fullName: true, phone: true, currentDesignation: true },
      },
    },
  },
  findingRecordedBy: {
    select: {
      id: true,
      email: true,
      employee: { select: { fullName: true } },
    },
  },
  selectedFinalApprover: {
    select: {
      id: true,
      email: true,
      employee: { select: { fullName: true, phone: true } },
    },
  },
  finalDecidedBy: {
    select: {
      id: true,
      email: true,
      employee: { select: { fullName: true } },
    },
  },
  destinationBranch: {
    select: { id: true, name: true, abbreviation: true },
  },
  disciplinaryAction: {
    include: {
      employee: {
        include: {
          currentBranch: {
            select: { id: true, name: true, abbreviation: true },
          },
          currentDepartment: { select: { id: true, name: true } },
        },
      },
      suspensionRequest: {
        select: {
          id: true,
          status: true,
          suspendedFromBranchId: true,
          suspendedFromBranch: {
            select: { id: true, name: true, abbreviation: true },
          },
        },
      },
    },
  },
} as const;

@Injectable()
export class InquiryDecisionService {
  constructor(
    private prisma: PrismaService,
    private lettersService: LettersService,
    private suspensionRequestService: SuspensionRequestService,
    private whatsapp: WhatsAppService,
  ) {}

  async recordFinding(
    inquiryId: string,
    finding: InquiryFinding,
    actingUserId: string,
    notes?: string,
    actingRole?: UserRole,
    actingRoles?: UserRole[],
  ) {
    const inquiry = await this.loadInquiry(inquiryId);
    this.assertOpen(inquiry);

    const actingUser = await this.prisma.user.findUnique({
      where: { id: actingUserId },
      select: {
        id: true,
        isActive: true,
        role: true,
        additionalRoles: { select: { role: true } },
      },
    });
    if (!actingUser?.isActive) {
      throw new ForbiddenException('This account cannot record a finding.');
    }

    if (inquiry.inquiryOfficerUserId) {
      if (inquiry.inquiryOfficerUserId !== actingUserId) {
        throw new ForbiddenException(
          'Only the assigned inquiry officer can record the finding.',
        );
      }
    } else {
      const roles =
        actingRoles?.length
          ? actingRoles
          : [actingRole ?? actingUser.role, ...actingUser.additionalRoles.map((r) => r.role)];
      this.assertLegacyFindingRole(roles);
    }

    if (inquiry.finding) {
      if (inquiry.finding === finding) {
        return inquiry;
      }
      throw new BadRequestException(
        'A finding has already been recorded for this inquiry.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.inquiry.updateMany({
        where: { id: inquiryId, finding: null, closedAt: null },
        data: {
          finding,
          findingRecordedById: actingUserId,
          findingRecordedAt: new Date(),
          notes: notes ?? inquiry.notes,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'A finding has already been recorded for this inquiry.',
        );
      }
      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'INQUIRY_FINDING_RECORDED',
          entity: 'Inquiry',
          entityId: inquiryId,
          changes: {
            finding,
            disciplinaryActionId: inquiry.disciplinaryActionId,
            employeeId: inquiry.disciplinaryAction.employeeId,
          },
        },
      });
      return tx.inquiry.findUnique({
        where: { id: inquiryId },
        include: INQUIRY_INCLUDE,
      });
    });

    return updated;
  }

  /**
   * HR close form: record finding + recommendation + required action.
   * Legacy inquiries with no officer apply immediately (auto-approval).
   * New inquiries notify the officer in Urdu, then wait for final approver.
   */
  async closeInquiry(
    inquiryId: string,
    dto: {
      finding: InquiryFinding;
      notes?: string;
      closeRecommendation?: string;
      selectedApproverUserId?: string;
      destinationBranchId?: string;
      finalAction?: InquiryFinalAction;
      fineAmount?: number;
    },
    actingUserId: string,
    actingRole: UserRole,
    actingRoles?: UserRole[],
  ) {
    this.assertPrepareRole(actingRole, actingRoles);
    const inquiry = await this.loadInquiry(inquiryId);
    this.assertOfficiallyOpen(inquiry);
    if (
      inquiry.finalDecisionStatus === InquiryFinalDecisionStatus.PENDING_APPROVAL ||
      inquiry.finalDecisionStatus === InquiryFinalDecisionStatus.APPLIED
    ) {
      throw new BadRequestException(
        'A final decision is already pending or applied.',
      );
    }

    const isLegacyNoOfficer = !inquiry.inquiryOfficerUserId;
    if (!isLegacyNoOfficer && !dto.selectedApproverUserId) {
      throw new BadRequestException('Select whose approval is required.');
    }

    await this.prisma.inquiry.update({
      where: { id: inquiryId },
      data: {
        finding: dto.finding,
        findingRecordedById: actingUserId,
        findingRecordedAt: new Date(),
        notes: dto.notes ?? inquiry.notes,
        closeRecommendation: dto.closeRecommendation ?? inquiry.closeRecommendation,
      },
    });

    const withFinding = await this.loadInquiry(inquiryId);

    if (isLegacyNoOfficer) {
      const payload = await this.validateDecisionPayload(withFinding, {
        destinationBranchId: dto.destinationBranchId,
        finalAction: dto.finalAction,
        fineAmount: dto.fineAmount,
      });
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.inquiry.update({
          where: { id: inquiryId },
          data: {
            finalAction: payload.finalAction,
            finalDecisionStatus: InquiryFinalDecisionStatus.APPLIED,
            selectedFinalApproverUserId: actingUserId,
            finalDecisionSubmittedById: actingUserId,
            finalDecisionSubmittedAt: now,
            finalDecidedById: actingUserId,
            finalDecidedAt: now,
            finalDecisionNote: 'Legacy inquiry: automatic approval (no inquiry officer assigned).',
            destinationBranchId: payload.destinationBranchId,
            fineAmount: payload.fineAmount,
          },
        });
        const snapshot = await tx.inquiry.findUnique({
          where: { id: inquiryId },
          include: INQUIRY_INCLUDE,
        });
        if (!snapshot) throw new NotFoundException('Inquiry not found');
        await this.applyApprovedDecision(tx, snapshot as never, actingUserId, now);
      });
      await this.generatePostApplyLetters(await this.loadInquiry(inquiryId), actingUserId);
      return this.loadInquiry(inquiryId);
    }

    const submitted = await this.submitFinalDecision(
      inquiryId,
      {
        selectedApproverUserId: dto.selectedApproverUserId!,
        destinationBranchId: dto.destinationBranchId,
        finalAction: dto.finalAction,
        fineAmount: dto.fineAmount,
        notes: dto.notes,
      },
      actingUserId,
      actingRole,
      actingRoles,
    );

    const employee = submitted?.disciplinaryAction.employee;
    const officer = submitted?.inquiryOfficer;
    await notifyInquiryOfficerResultWhatsApp(this.whatsapp, {
      phone: officer?.employee?.phone,
      officerName: officer?.employee?.fullName,
      employeeName: employee?.fullName ?? '',
      employeeCode: employee?.employeeCode,
      finding: submitted?.finding,
      finalAction: submitted?.finalAction,
      recommendation: dto.closeRecommendation,
      notes: dto.notes,
    });
    await notifyInquiryApproverWhatsApp(this.whatsapp, {
      kind: 'close',
      phone: submitted?.selectedFinalApprover?.employee?.phone,
      approverName: submitted?.selectedFinalApprover?.employee?.fullName,
      employeeName: employee?.fullName ?? '',
      employeeCode: employee?.employeeCode,
      reason: submitted?.disciplinaryAction.reason,
    });

    return submitted;
  }

  async submitFinalDecision(
    inquiryId: string,
    dto: {
      selectedApproverUserId: string;
      destinationBranchId?: string;
      finalAction?: InquiryFinalAction;
      fineAmount?: number;
      notes?: string;
    },
    actingUserId: string,
    actingRole: UserRole,
    actingRoles?: UserRole[],
  ) {
    this.assertPrepareRole(actingRole, actingRoles);
    const inquiry = await this.loadInquiry(inquiryId);
    this.assertOpen(inquiry);
    if (!inquiry.finding) {
      throw new BadRequestException(
        'Record an inquiry finding before selecting a final action.',
      );
    }
    if (
      inquiry.finalDecisionStatus === InquiryFinalDecisionStatus.PENDING_APPROVAL ||
      inquiry.finalDecisionStatus === InquiryFinalDecisionStatus.APPLIED
    ) {
      throw new BadRequestException(
        'A final decision is already pending or applied.',
      );
    }

    await this.assertEligibleApprover(dto.selectedApproverUserId);
    const payload = await this.validateDecisionPayload(inquiry, dto);

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.inquiry.updateMany({
        where: {
          id: inquiryId,
          closedAt: null,
          finding: inquiry.finding,
          OR: [
            { finalDecisionStatus: null },
            { finalDecisionStatus: InquiryFinalDecisionStatus.REJECTED },
          ],
        },
        data: {
          finalAction: payload.finalAction,
          finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
          selectedFinalApproverUserId: dto.selectedApproverUserId,
          finalDecisionSubmittedById: actingUserId,
          finalDecisionSubmittedAt: new Date(),
          finalDecidedById: null,
          finalDecidedAt: null,
          finalDecisionNote: null,
          destinationBranchId: payload.destinationBranchId,
          fineAmount: payload.fineAmount,
          notes: dto.notes ?? inquiry.notes,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'A final decision is already pending or applied.',
        );
      }
      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'FINAL_ACTION_SELECTED',
          entity: 'Inquiry',
          entityId: inquiryId,
          changes: {
            finding: inquiry.finding,
            finalAction: payload.finalAction,
            destinationBranchId: payload.destinationBranchId,
            selectedFinalApproverUserId: dto.selectedApproverUserId,
          },
        },
      });
      return tx.inquiry.findUnique({
        where: { id: inquiryId },
        include: INQUIRY_INCLUDE,
      });
    });

    return updated;
  }

  async listMyPending(actingUserId: string) {
    return this.prisma.inquiry.findMany({
      where: {
        selectedFinalApproverUserId: actingUserId,
        finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
        closedAt: null,
      },
      include: INQUIRY_INCLUDE,
      orderBy: { finalDecisionSubmittedAt: 'asc' },
    });
  }

  async findOneForApprover(inquiryId: string, actingUserId: string) {
    const inquiry = await this.loadInquiry(inquiryId);
    if (inquiry.selectedFinalApproverUserId !== actingUserId) {
      throw new ForbiddenException(
        'This inquiry decision is not assigned to you.',
      );
    }
    return inquiry;
  }

  async approve(
    inquiryId: string,
    actingUserId: string,
    note?: string,
  ) {
    const inquiry = await this.loadInquiry(inquiryId);
    if (inquiry.selectedFinalApproverUserId !== actingUserId) {
      throw new ForbiddenException(
        'Only the selected approver can approve this decision.',
      );
    }
    const actingUser = await this.prisma.user.findUnique({
      where: { id: actingUserId },
      select: { isActive: true },
    });
    if (!actingUser?.isActive) {
      throw new ForbiddenException('This account cannot approve.');
    }
    this.assertOpen(inquiry);
    if (
      inquiry.finalDecisionStatus !== InquiryFinalDecisionStatus.PENDING_APPROVAL
    ) {
      throw new BadRequestException('This decision is not pending approval.');
    }

    const now = new Date();
    const applyResult = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.inquiry.updateMany({
        where: {
          id: inquiryId,
          closedAt: null,
          selectedFinalApproverUserId: actingUserId,
          finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
        },
        data: {
          finalDecisionStatus: InquiryFinalDecisionStatus.APPLIED,
          finalDecidedById: actingUserId,
          finalDecidedAt: now,
          finalDecisionNote: note?.trim() || null,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This decision is no longer pending.');
      }

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'FINAL_ACTION_APPROVED',
          entity: 'Inquiry',
          entityId: inquiryId,
          changes: {
            finding: inquiry.finding,
            finalAction: inquiry.finalAction,
          },
        },
      });

      return this.applyApprovedDecision(tx, inquiry, actingUserId, now);
    });

    await this.generatePostApplyLetters(inquiry, actingUserId);
    return this.loadInquiry(inquiryId);
  }

  async reject(inquiryId: string, actingUserId: string, reason: string) {
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new BadRequestException('A rejection reason is required.');
    }
    const inquiry = await this.loadInquiry(inquiryId);
    if (inquiry.selectedFinalApproverUserId !== actingUserId) {
      throw new ForbiddenException(
        'Only the selected approver can reject this decision.',
      );
    }
    const claimed = await this.prisma.inquiry.updateMany({
      where: {
        id: inquiryId,
        closedAt: null,
        selectedFinalApproverUserId: actingUserId,
        finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      },
      data: {
        finalDecisionStatus: InquiryFinalDecisionStatus.REJECTED,
        finalDecidedById: actingUserId,
        finalDecidedAt: new Date(),
        finalDecisionNote: trimmed,
      },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('This decision is no longer pending.');
    }
    await this.prisma.auditLog.create({
      data: {
        userId: actingUserId,
        action: 'FINAL_ACTION_REJECTED',
        entity: 'Inquiry',
        entityId: inquiryId,
        changes: { reason: trimmed },
      },
    });
    return this.loadInquiry(inquiryId);
  }

  private async applyApprovedDecision(
    tx: Prisma.TransactionClient,
    inquiry: Awaited<ReturnType<InquiryDecisionService['loadInquiry']>>,
    actingUserId: string,
    now: Date,
  ) {
    const employee = inquiry.disciplinaryAction.employee;
    const finding = inquiry.finding;
    const result: {
      outcome: InquiryOutcome;
      employeeStatus: EmployeeStatus;
      transferred: boolean;
      fineDeductionId: string | null;
      fineSkippedReason: string | null;
    } = {
      outcome: InquiryOutcome.REINSTATED,
      employeeStatus: EmployeeStatus.ACTIVE,
      transferred: false,
      fineDeductionId: null,
      fineSkippedReason: null,
    };

    if (finding === InquiryFinding.NOT_GUILTY) {
      const transferred = await this.applyReinstatementPlacement(
        tx,
        inquiry,
        now,
      );
      result.transferred = transferred;
      result.outcome = InquiryOutcome.REINSTATED;
      result.employeeStatus = EmployeeStatus.ACTIVE;
      await tx.employee.update({
        where: { id: employee.id },
        data: suspensionInquiryReinstatementData(now),
      });
      await tx.user.updateMany({
        where: { employeeId: employee.id },
        data: { isActive: true },
      });
      if (transferred) {
        await this.audit(tx, actingUserId, 'EMPLOYEE_TRANSFERRED', employee.id, {
          inquiryId: inquiry.id,
          destinationBranchId: inquiry.destinationBranchId,
        });
      }
      await this.audit(tx, actingUserId, 'EMPLOYEE_REINSTATED', employee.id, {
        inquiryId: inquiry.id,
        finding,
      });
    } else if (inquiry.finalAction === InquiryFinalAction.DISMISS) {
      result.outcome = InquiryOutcome.DISMISSED;
      result.employeeStatus = EmployeeStatus.DISMISSED;
      await tx.employee.update({
        where: { id: employee.id },
        data: { status: EmployeeStatus.DISMISSED },
      });
      await tx.user.updateMany({
        where: { employeeId: employee.id },
        data: { isActive: false },
      });
      await this.audit(tx, actingUserId, 'EMPLOYEE_DISMISSED', employee.id, {
        inquiryId: inquiry.id,
      });
    } else if (inquiry.finalAction === InquiryFinalAction.TERMINATE) {
      result.outcome = InquiryOutcome.TERMINATED;
      result.employeeStatus = EmployeeStatus.TERMINATED;
      await tx.employee.update({
        where: { id: employee.id },
        data: { status: EmployeeStatus.TERMINATED },
      });
      await tx.user.updateMany({
        where: { employeeId: employee.id },
        data: { isActive: false },
      });
      await this.audit(tx, actingUserId, 'EMPLOYEE_TERMINATED', employee.id, {
        inquiryId: inquiry.id,
      });
    } else if (inquiry.finalAction === InquiryFinalAction.REST) {
      result.outcome = InquiryOutcome.REST;
      result.employeeStatus = EmployeeStatus.ON_REST;
      await tx.employee.update({
        where: { id: employee.id },
        data: { status: EmployeeStatus.ON_REST },
      });
      await this.audit(tx, actingUserId, 'EMPLOYEE_RESTED', employee.id, {
        inquiryId: inquiry.id,
      });
    } else if (inquiry.finalAction === InquiryFinalAction.FINE_AND_REINSTATE) {
      const fine = await this.applyDisciplinaryFine(tx, inquiry, now);
      result.fineDeductionId = fine.deductionId;
      result.fineSkippedReason = null;
      const transferred = await this.applyReinstatementPlacement(
        tx,
        inquiry,
        now,
      );
      result.transferred = transferred;
      result.outcome = InquiryOutcome.REINSTATED;
      result.employeeStatus = EmployeeStatus.ACTIVE;
      await tx.employee.update({
        where: { id: employee.id },
        data: suspensionInquiryReinstatementData(now),
      });
      await tx.user.updateMany({
        where: { employeeId: employee.id },
        data: { isActive: true },
      });
      await this.audit(tx, actingUserId, 'FINE_APPLIED', employee.id, {
        inquiryId: inquiry.id,
        amount: inquiry.fineAmount,
        deductionId: fine.deductionId,
        payrollEntryId: fine.payrollEntryId,
      });
      if (transferred) {
        await this.audit(tx, actingUserId, 'EMPLOYEE_TRANSFERRED', employee.id, {
          inquiryId: inquiry.id,
          destinationBranchId: inquiry.destinationBranchId,
        });
      }
      await this.audit(tx, actingUserId, 'EMPLOYEE_REINSTATED', employee.id, {
        inquiryId: inquiry.id,
        finding,
      });
    } else {
      throw new BadRequestException('Final action is missing or invalid.');
    }

    await tx.inquiry.update({
      where: { id: inquiry.id },
      data: {
        outcome: result.outcome,
        closedAt: now,
        appliedFineDeductionId: result.fineDeductionId,
      },
    });

    await tx.disciplinaryAction.update({
      where: { id: inquiry.disciplinaryAction.id },
      data: {
        status:
          result.outcome === InquiryOutcome.DISMISSED
            ? DisciplinaryStatus.DISMISSED
            : DisciplinaryStatus.RESOLVED,
        resolvedAt: now,
        resolution: `${finding} / ${inquiry.finalAction ?? 'TRANSFER_REINSTATE'}`,
      },
    });

    await tx.suspensionRequest.updateMany({
      where: {
        disciplinaryActionId: inquiry.disciplinaryActionId,
        status: SuspensionRequestStatus.ISSUED,
      },
      data: { status: SuspensionRequestStatus.COMPLETED },
    });

    await this.audit(tx, actingUserId, 'FINAL_ACTION_APPLIED', inquiry.id, {
      finding,
      finalAction: inquiry.finalAction,
      outcome: result.outcome,
      employeeStatus: result.employeeStatus,
      transferred: result.transferred,
      fineDeductionId: result.fineDeductionId,
    });

    if (restNotifiesOnApply(finding, inquiry.finalAction)) {
      await ensureInquiryResolvedNotification(tx, {
        employeeId: employee.id,
        inquiryId: inquiry.id,
        finding: String(finding),
      });
    }

    return result;
  }

  private async applyReinstatementPlacement(
    tx: Prisma.TransactionClient,
    inquiry: Awaited<ReturnType<InquiryDecisionService['loadInquiry']>>,
    now: Date,
  ): Promise<boolean> {
    const employee = inquiry.disciplinaryAction.employee;
    const destinationId = inquiry.destinationBranchId;
    if (!destinationId) {
      throw new BadRequestException('A duty branch is required.');
    }
    if (employee.currentBranchId === destinationId) {
      return false;
    }
    if (!employee.currentDepartmentId || !employee.currentDesignation) {
      throw new BadRequestException(
        'Employee department and designation are required before transfer.',
      );
    }

    const transferReason = `Inquiry reinstatement placement (${inquiry.finding}) [${inquiry.id}]`;
    const existingTransfer = await tx.employmentHistory.findFirst({
      where: { employeeId: employee.id, changeReason: transferReason },
    });
    if (existingTransfer) {
      if (employee.currentBranchId !== destinationId) {
        await tx.employee.update({
          where: { id: employee.id },
          data: { currentBranchId: destinationId },
        });
        return true;
      }
      return false;
    }

    const openHistory = await tx.employmentHistory.findFirst({
      where: { employeeId: employee.id, endDate: null },
      orderBy: { effectiveDate: 'desc' },
    });
    if (openHistory) {
      await tx.employmentHistory.update({
        where: { id: openHistory.id },
        data: { endDate: now },
      });
    }

    await tx.employee.update({
      where: { id: employee.id },
      data: { currentBranchId: destinationId },
    });

    await tx.employmentHistory.create({
      data: {
        employeeId: employee.id,
        branchId: destinationId,
        departmentId: employee.currentDepartmentId,
        designation: employee.currentDesignation,
        changeType: ChangeType.TRANSFERRED,
        changeReason: transferReason,
        effectiveDate: now,
      },
    });
    return true;
  }

  private async applyDisciplinaryFine(
    tx: Prisma.TransactionClient,
    inquiry: Awaited<ReturnType<InquiryDecisionService['loadInquiry']>>,
    now: Date,
  ) {
    if (inquiry.appliedFineDeductionId) {
      return {
        deductionId: inquiry.appliedFineDeductionId,
        payrollEntryId: null as string | null,
      };
    }
    const amount = Number(inquiry.fineAmount ?? 0);
    if (!(amount > 0)) {
      throw new BadRequestException('A fine amount is required.');
    }
    const description = `Inquiry fine ${inquiry.id}`;
    const employeeId = inquiry.disciplinaryAction.employeeId;
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const pendingEntries = await tx.payrollEntry.findMany({
      where: {
        stipendRecord: { employeeId },
        status: PayrollStatus.PENDING,
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
    });
    const entry =
      pendingEntries.find((row) => row.month === month && row.year === year) ??
      pendingEntries[0];

    if (!entry) {
      throw new BadRequestException(
        'Cannot apply FINE_AND_REINSTATE because there is no PENDING payroll entry to receive the disciplinary fine. PROCESSED/PAID payroll was not changed. Create a PENDING payroll entry, then approve again.',
      );
    }

    const existing = await tx.payrollDeduction.findFirst({
      where: {
        payrollEntryId: entry.id,
        reason: DeductionType.DISCIPLINARY_FINE,
        description,
      },
    });
    if (existing) {
      return { deductionId: existing.id, payrollEntryId: entry.id };
    }
    const created = await tx.payrollDeduction.create({
      data: {
        payrollEntryId: entry.id,
        reason: DeductionType.DISCIPLINARY_FINE,
        amount,
        description,
      },
    });
    await tx.payrollEntry.update({
      where: { id: entry.id },
      data: {
        totalDeductions: { increment: amount },
        netStipend: { decrement: amount },
      },
    });
    return { deductionId: created.id, payrollEntryId: entry.id };
  }

  async generateMissingFinalLetters(
    inquiryId: string,
    actingUserId: string,
    actingRole: UserRole,
    actingRoles?: UserRole[],
  ) {
    this.assertPrepareRole(actingRole, actingRoles);
    const inquiry = await this.loadInquiry(inquiryId);
    if (
      !inquiry.closedAt ||
      inquiry.finalDecisionStatus !== InquiryFinalDecisionStatus.APPLIED
    ) {
      throw new BadRequestException(
        'Missing final letters can only be generated after the decision is applied.',
      );
    }

    const before = await this.listFinalLetterStatuses(inquiry);
    await this.generatePostApplyLetters(inquiry, actingUserId, {
      swallowErrors: false,
    });
    const after = await this.listFinalLetterStatuses(inquiry);
    const generated = after.filter(
      (row, index) =>
        before[index]?.status === 'MISSING' && row.status !== 'MISSING',
    );
    if (generated.length) {
      await this.prisma.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'FINAL_LETTERS_RECOVERED',
          entity: 'Inquiry',
          entityId: inquiryId,
          changes: {
            kinds: generated.map((row) => row.inquiryLetterKind),
          },
        },
      });
    }

    return {
      id: inquiryId,
      generated: generated.map((row) => row.inquiryLetterKind),
      finalLetters: after,
    };
  }

  async listFinalLetterStatuses(
    inquiry: {
      id: string;
      finding: InquiryFinding | null;
      finalAction: InquiryFinalAction | null;
      disciplinaryAction: { employeeId: string };
    },
  ) {
    const expected = expectedFinalLetters(inquiry.finding, inquiry.finalAction);
    if (!expected.length) {
      return [];
    }
    const letters = await this.prisma.letter.findMany({
      where: {
        employeeId: inquiry.disciplinaryAction.employeeId,
        letterType: { in: expected.map((row) => row.letterType) },
        status: { not: LetterStatus.REVERSED },
      },
      select: {
        id: true,
        letterType: true,
        status: true,
        letterNo: true,
        content: true,
      },
    });
    return matchFinalLetterStatuses(expected, letters, inquiry.id);
  }

  private async generatePostApplyLetters(
    inquiry: Awaited<ReturnType<InquiryDecisionService['loadInquiry']>>,
    actingUserId: string,
    opts?: { swallowErrors?: boolean },
  ) {
    const expected = expectedFinalLetters(inquiry.finding, inquiry.finalAction);
    try {
      for (const spec of expected) {
        await this.ensureFinalLetter(inquiry, spec, actingUserId);
      }
    } catch (err) {
      if (opts?.swallowErrors === false) {
        throw err;
      }
      console.error(
        `Post-inquiry letter generation failed for ${inquiry.id}:`,
        err,
      );
    }
  }

  private extraFieldsForKind(
    inquiry: Awaited<ReturnType<InquiryDecisionService['loadInquiry']>>,
    spec: ExpectedFinalLetter,
  ): Record<string, unknown> {
    const employee = inquiry.disciplinaryAction.employee;
    const today = this.formatDate(new Date());
    if (spec.inquiryLetterKind === 'REINSTATEMENT') {
      return {
        reinstatementDate: today,
        reinstatedDesignation: employee.currentDesignation,
        reinstatedDepartment: employee.currentDepartment?.name,
      };
    }
    if (spec.inquiryLetterKind === 'FINE') {
      return {
        fineReason: inquiry.disciplinaryAction.reason,
        fineAmount: String(inquiry.fineAmount ?? ''),
        deductionMonth: `${new Date().getMonth() + 1}/${new Date().getFullYear()}`,
      };
    }
    if (spec.inquiryLetterKind === 'TERMINATION') {
      return {
        terminationReason: inquiry.disciplinaryAction.reason,
        terminationDate: today,
        settlementDetails: 'As per HR policy',
      };
    }
    return {
      terminationReason: 'Dismissed following inquiry',
      terminationDate: today,
      settlementDetails: inquiry.disciplinaryAction.reason,
    };
  }

  private async ensureFinalLetter(
    inquiry: Awaited<ReturnType<InquiryDecisionService['loadInquiry']>>,
    spec: ExpectedFinalLetter,
    actingUserId: string,
  ) {
    const employeeId = inquiry.disciplinaryAction.employeeId;
    const existing = await this.prisma.letter.findFirst({
      where: {
        employeeId,
        letterType: spec.letterType,
        status: { not: LetterStatus.REVERSED },
        AND: [
          { content: { path: ['inquiryId'], equals: inquiry.id } },
          {
            content: {
              path: ['inquiryLetterKind'],
              equals: spec.inquiryLetterKind,
            },
          },
        ],
      },
      select: { id: true },
    });
    if (existing) {
      return existing;
    }

    return this.lettersService.generateSystemLetter(
      {
        employeeId,
        letterType: spec.letterType,
        extraFields: {
          ...this.extraFieldsForKind(inquiry, spec),
          inquiryId: inquiry.id,
          inquiryLetterKind: spec.inquiryLetterKind,
        },
      },
      actingUserId,
    );
  }

  private async validateDecisionPayload(
    inquiry: Awaited<ReturnType<InquiryDecisionService['loadInquiry']>>,
    dto: {
      destinationBranchId?: string;
      finalAction?: InquiryFinalAction;
      fineAmount?: number;
    },
  ) {
    if (inquiry.finding === InquiryFinding.NOT_GUILTY) {
      if (dto.finalAction) {
        throw new BadRequestException(
          'NOT_GUILTY does not take a GUILTY final action. Choose the duty branch; the employee may stay at the same branch or move to another.',
        );
      }
      const destinationBranchId = await this.assertDutyBranch(
        dto.destinationBranchId,
      );
      return {
        finalAction: null as InquiryFinalAction | null,
        destinationBranchId,
        fineAmount: null as number | null,
      };
    }

    if (!dto.finalAction) {
      throw new BadRequestException(
        'Select DISMISS, TERMINATE, REST, or FINE_AND_REINSTATE.',
      );
    }
    if (dto.finalAction === InquiryFinalAction.FINE_AND_REINSTATE) {
      const destinationBranchId = await this.assertDutyBranch(
        dto.destinationBranchId,
      );
      const fineAmount = Number(dto.fineAmount);
      if (!(fineAmount > 0)) {
        throw new BadRequestException('Enter a fine amount greater than zero.');
      }
      return { finalAction: dto.finalAction, destinationBranchId, fineAmount };
    }
    return {
      finalAction: dto.finalAction,
      destinationBranchId: null as string | null,
      fineAmount: null as number | null,
    };
  }

  private async assertDutyBranch(destinationBranchId?: string) {
    if (!destinationBranchId) {
      throw new BadRequestException(
        'Select the branch where the employee will continue duties. The same branch as before is allowed.',
      );
    }
    const branch = await this.prisma.branch.findUnique({
      where: { id: destinationBranchId },
      select: { id: true, isActive: true },
    });
    if (!branch?.isActive) {
      throw new BadRequestException('Duty branch was not found.');
    }
    return branch.id;
  }

  private assertOfficiallyOpen(
    inquiry: Awaited<ReturnType<InquiryDecisionService['loadInquiry']>>,
  ) {
    this.assertOpen(inquiry);
    if (!inquiry.officiallyOpenedAt) {
      throw new BadRequestException(
        'This inquiry is not officially open yet. Wait for opening approval.',
      );
    }
  }

  private assertOpen(
    inquiry: Awaited<ReturnType<InquiryDecisionService['loadInquiry']>>,
  ) {
    if (inquiry.closedAt || inquiry.outcome) {
      throw new BadRequestException('This inquiry is already closed.');
    }
  }

  private async loadInquiry(inquiryId: string) {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      include: INQUIRY_INCLUDE,
    });
    if (!inquiry) {
      throw new NotFoundException(`Inquiry with id ${inquiryId} not found`);
    }
    if (inquiry.disciplinaryAction.type !== DisciplinaryType.SUSPENSION) {
      throw new BadRequestException(
        'This workflow applies to SUSPENSION inquiries only.',
      );
    }
    return inquiry;
  }

  private async assertEligibleApprover(userId: string) {
    const eligible = await this.suspensionRequestService.listEligibleApprovers();
    if (!eligible.some((row) => row.id === userId)) {
      throw new BadRequestException(
        'Selected approver is not eligible to authorize a final inquiry action.',
      );
    }
  }

  private assertPrepareRole(actingRole: UserRole, actingRoles?: UserRole[]) {
    const roles = actingRoles?.length ? actingRoles : [actingRole];
    if (hasAnyRole(roles, [UserRole.HR_EXECUTIVE])) {
      throw new ForbiddenException(
        'HR Executive cannot submit a final inquiry decision.',
      );
    }
    if (!hasAnyRole(roles, SUSPENSION_PREPARE_ROLES)) {
      throw new ForbiddenException(
        'You are not allowed to submit a final inquiry decision.',
      );
    }
  }

  private assertLegacyFindingRole(roles: UserRole[]) {
    if (hasAnyRole(roles, [UserRole.HR_EXECUTIVE])) {
      throw new ForbiddenException(
        'HR Executive cannot record a finding on an unassigned inquiry.',
      );
    }
    if (!hasAnyRole(roles, SUSPENSION_PREPARE_ROLES)) {
      throw new ForbiddenException(
        'Only Super Admin, HR Manager, or Admin Manager may record a finding when no inquiry officer is assigned.',
      );
    }
  }

  private async audit(
    tx: Prisma.TransactionClient,
    userId: string,
    action: string,
    entityId: string,
    changes: Record<string, unknown>,
  ) {
    await tx.auditLog.create({
      data: {
        userId,
        action,
        entity:
          action.startsWith('EMPLOYEE') || action === 'FINE_APPLIED'
            ? 'Employee'
            : 'Inquiry',
        entityId,
        changes: changes as Prisma.InputJsonValue,
      },
    });
  }

  private formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
