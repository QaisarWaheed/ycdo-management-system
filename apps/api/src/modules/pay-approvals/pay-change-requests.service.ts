import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeApproverTarget,
  PayChangeKind,
  PayChangeStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { syncLegacyAllowanceRows } from '../allowances/package-allowances.util';
import {
  APPROVER_TARGET_LABELS,
  approverTargetForUserRole,
} from '../employee-onboarding/employee-onboarding.util';

export type PayActor = { id: string; role: UserRole | string; roles?: string[] };

/** Roles whose pay changes apply at once (they are the approvers). */
export const PAY_EXECUTIVE_ROLES: UserRole[] = [
  UserRole.PRESIDENT,
  UserRole.FOUNDER,
  UserRole.CHAIRMAN,
  UserRole.SUPER_ADMIN,
];

export function isPayExecutive(user: PayActor): boolean {
  const roles = user.roles?.length ? user.roles : [user.role];
  return roles.some((r) => PAY_EXECUTIVE_ROLES.includes(r as UserRole));
}

const PACKAGE_EARNINGS = ['basicStipend', 'allowances', 'reward', 'progressReward', 'fuelAllowance'] as const;
const PACKAGE_DEDUCTIONS = ['loanDeduction', 'advanceDeduction', 'fineDeduction', 'healthDeduction'] as const;
const FIELD_LABELS: Record<string, string> = {
  basicStipend: 'Basic',
  allowances: 'Travelling Exp',
  reward: 'Reward',
  progressReward: 'Reward On Progress',
  fuelAllowance: 'Petrol',
  loanDeduction: 'Loan deduction',
  advanceDeduction: 'Advance deduction',
  fineDeduction: 'Fine deduction',
  healthDeduction: 'Health deduction',
};

export const pkr = (n: number) => Math.round(n).toLocaleString('en-PK');
export const monthLabel = (year: number, month: number) =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Pay increases from non-executives become requests that an executive
 * approves, like the new-employee approval. This service only records and
 * routes them; PayApprovalsService applies an approved one.
 */
@Injectable()
export class PayChangeRequestsService {
  constructor(private prisma: PrismaService) {}

  async submit(
    input: {
      kind: PayChangeKind;
      employeeId: string;
      payload: Record<string, unknown>;
      summary: string;
      reason?: string | null;
      approverTarget?: EmployeeApproverTarget | null;
    },
    user: PayActor,
  ) {
    if (!input.approverTarget) {
      throw new BadRequestException(
        'This increases pay and needs approval: choose President, Founder or Chairman Admin',
      );
    }
    const { approverTarget: _drop, ...payload } = input.payload;
    const request = await this.prisma.payChangeRequest.create({
      data: {
        kind: input.kind,
        employeeId: input.employeeId,
        payload: payload as Prisma.InputJsonValue,
        summary: input.summary,
        reason: input.reason?.trim() || null,
        approverTarget: input.approverTarget,
        submittedById: user.id,
      },
    });
    await this.audit(user, 'PAY_CHANGE_REQUESTED', request, {
      approverTarget: input.approverTarget,
    });
    return {
      pendingApproval: true as const,
      approverLabel: APPROVER_TARGET_LABELS[input.approverTarget],
      request,
    };
  }

  /**
   * Increment / package edit: an increase if any earning goes up or any
   * package deduction goes down (both raise what is payable).
   */
  async describePackageChange(
    employeeId: string,
    dto: Record<string, unknown> & { effectiveFrom?: string },
  ): Promise<{ isIncrease: boolean; summary: string }> {
    const active = await this.prisma.stipendRecord.findFirst({
      where: { employeeId, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!active) return { isIncrease: false, summary: '' };
    const changes: string[] = [];
    let isIncrease = false;
    for (const field of [...PACKAGE_EARNINGS, ...PACKAGE_DEDUCTIONS]) {
      if (dto[field] == null) continue;
      const before = Number(active[field] ?? 0);
      const after = Number(dto[field]);
      if (after === before) continue;
      changes.push(`${FIELD_LABELS[field]} ${pkr(before)} → ${pkr(after)}`);
      const earning = (PACKAGE_EARNINGS as readonly string[]).includes(field);
      if (earning ? after > before : after < before) isIncrease = true;
    }
    const from = dto.effectiveFrom ? new Date(dto.effectiveFrom) : null;
    const when =
      from && !Number.isNaN(from.getTime())
        ? ` from ${monthLabel(from.getUTCFullYear(), from.getUTCMonth() + 1)}`
        : '';
    return { isIncrease, summary: `${changes.join(', ') || 'No change'}${when}` };
  }

  /** After any package save: keep the copied November rows equal to the open package. */
  async afterPackageChange(employeeId: string) {
    await syncLegacyAllowanceRows(this.prisma, employeeId);
  }

  /** Manual "Add Allowance" on a payroll entry (always raises pay). */
  async describePayrollAddition(dto: {
    payrollEntryId: string;
    amount?: number;
    hours?: number;
    description?: string;
  }) {
    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: dto.payrollEntryId },
      select: { month: true, year: true, stipendRecord: { select: { employeeId: true } } },
    });
    if (!entry) throw new NotFoundException('Payroll entry not found');
    const what = dto.amount != null ? pkr(dto.amount) : `${dto.hours} extra hours`;
    const note = dto.description?.trim() ? ` (${dto.description.trim()})` : '';
    return {
      employeeId: entry.stipendRecord.employeeId,
      summary: `Payroll addition ${what}${note} for ${monthLabel(entry.year, entry.month)}`,
    };
  }

  async describeIncentive(dto: {
    typeId?: string;
    reason?: string;
    amount: number;
    month: number;
    year: number;
  }) {
    const type = dto.typeId
      ? await this.prisma.incentiveType.findUnique({ where: { id: dto.typeId } })
      : null;
    const what = type?.name ?? dto.reason?.trim() ?? 'Incentive';
    return `Incentive (${what}) ${pkr(dto.amount)} for ${monthLabel(dto.year, dto.month)}`;
  }

  private readonly include = {
    employee: {
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        currentDesignation: true,
        currentBranch: { select: { name: true } },
      },
    },
    submittedBy: { select: { id: true, email: true, employee: { select: { fullName: true } } } },
    reviewedBy: { select: { id: true, email: true, employee: { select: { fullName: true } } } },
  } satisfies Prisma.PayChangeRequestInclude;

  /** Executives see their own queue; IT / HR / Accounts / Super Admin see all. */
  list(
    query: { status?: PayChangeStatus; employeeId?: string },
    user: PayActor,
  ) {
    const target = approverTargetForUserRole(user.role);
    return this.prisma.payChangeRequest.findMany({
      where: {
        status: query.status ?? PayChangeStatus.PENDING,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(target ? { approverTarget: target } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: this.include,
      take: 500,
    });
  }

  async getPending(id: string) {
    const request = await this.prisma.payChangeRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Pay change request not found');
    if (request.status !== PayChangeStatus.PENDING) {
      throw new BadRequestException('This request has already been decided');
    }
    return request;
  }

  assertCanReview(user: PayActor, approverTarget: EmployeeApproverTarget) {
    const roles = user.roles?.length ? user.roles : [user.role];
    if (roles.includes(UserRole.SUPER_ADMIN)) return;
    if (roles.some((r) => approverTargetForUserRole(r) === approverTarget)) return;
    throw new ForbiddenException(
      `Only the ${APPROVER_TARGET_LABELS[approverTarget]} can decide this request`,
    );
  }

  /** Atomically move PENDING → status; false if someone else decided first. */
  async claim(
    id: string,
    status: PayChangeStatus,
    user: PayActor,
    reviewNote?: string | null,
  ): Promise<boolean> {
    const { count } = await this.prisma.payChangeRequest.updateMany({
      where: { id, status: PayChangeStatus.PENDING },
      data: {
        status,
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewNote: reviewNote?.trim() || null,
      },
    });
    return count === 1;
  }

  /** Undo a claim when applying the approved change failed. */
  async release(id: string) {
    await this.prisma.payChangeRequest.update({
      where: { id },
      data: {
        status: PayChangeStatus.PENDING,
        reviewedById: null,
        reviewedAt: null,
        reviewNote: null,
      },
    });
  }

  async reject(id: string, user: PayActor, reviewNote: string) {
    const request = await this.getPending(id);
    this.assertCanReview(user, request.approverTarget);
    if (!(await this.claim(id, PayChangeStatus.REJECTED, user, reviewNote))) {
      throw new BadRequestException('This request has already been decided');
    }
    await this.audit(user, 'PAY_CHANGE_REJECTED', request, {
      reviewNote: reviewNote.trim(),
    });
    return { id, status: PayChangeStatus.REJECTED };
  }

  /** IT re-routes a pending request to another executive. */
  async forward(
    id: string,
    user: PayActor,
    approverTarget: EmployeeApproverTarget,
    reason: string,
  ) {
    const request = await this.getPending(id);
    if (request.approverTarget === approverTarget) {
      throw new BadRequestException(
        `This request is already with the ${APPROVER_TARGET_LABELS[approverTarget]}`,
      );
    }
    const { count } = await this.prisma.payChangeRequest.updateMany({
      where: { id, status: PayChangeStatus.PENDING },
      data: { approverTarget },
    });
    if (count === 0) throw new BadRequestException('This request has already been decided');
    await this.audit(user, 'PAY_CHANGE_FORWARDED', request, {
      from: request.approverTarget,
      to: approverTarget,
      reason: reason.trim(),
    });
    return { id, approverTarget };
  }

  async audit(
    user: PayActor,
    action: string,
    request: { id: string; kind: PayChangeKind; employeeId: string; summary: string },
    extra: Record<string, unknown> = {},
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action,
        entity: 'PayChangeRequest',
        entityId: request.id,
        changes: {
          kind: request.kind,
          employeeId: request.employeeId,
          summary: request.summary,
          ...extra,
        } as Prisma.InputJsonValue,
      },
    });
  }
}
