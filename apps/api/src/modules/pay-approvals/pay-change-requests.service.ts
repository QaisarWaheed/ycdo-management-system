import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeApproverTarget,
  EmployeeStatus,
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

export type PayActor = {
  id: string;
  role: UserRole | string;
  roles?: string[];
};

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

const PACKAGE_EARNINGS = [
  'basicStipend',
  'allowances',
  'reward',
  'progressReward',
  'fuelAllowance',
] as const;
const PACKAGE_DEDUCTIONS = [
  'loanDeduction',
  'advanceDeduction',
  'fineDeduction',
  'healthDeduction',
] as const;
const FIELD_LABELS: Record<string, string> = {
  basicStipend: 'Basic',
  allowances: 'Allowances',
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
/** One line of salary amendment history: what changed, in words. */
export function describeAmendment(
  action: string,
  c: Record<string, unknown>,
): { type: string; detail: string } {
  const n = (v: unknown) => `PKR ${pkr(Number(v) || 0)}`;
  switch (action) {
    case 'SALARY_INCREMENT':
      return {
        type: 'Salary increment',
        detail: `Basic ${n(c.previousSalary)} → ${n(c.newBasicStipend)}, package ${n(c.lumpsumTotal)}`,
      };
    case 'STIPEND_PACKAGE_CORRECTED':
      return {
        type: 'Package edited',
        detail: `Basic ${n(c.previousBasicStipend)} → ${n(c.newBasicStipend)}, package ${n(c.lumpsumTotal)}`,
      };
    case 'PAY_PACKAGE_VERIFIED':
      return {
        type: 'Verified by Finance',
        detail: 'Package locked; later changes need Founder approval',
      };
    case 'EMPLOYEE_ALLOWANCE_SET':
      return {
        type: 'Allowance set',
        detail: `${String(c.type ?? '')} ${n(c.before)} → ${n(c.after)} from ${String(c.startMonth ?? '')}${c.endMonth ? ` to ${String(c.endMonth)}` : ''}`,
      };
    case 'EMPLOYEE_ALLOWANCE_ENDED':
      return {
        type: 'Allowance ended',
        detail: `${String(c.type ?? '')} ${n(c.amount)}, last month ${String(c.endMonth ?? '')}`,
      };
    case 'LOAN_APPLICATION_CREATED':
      return {
        type: 'Loan applied',
        detail: `${n(c.amount)}, ${n(c.monthlyInstallment)} per month from ${String(c.startMonth ?? '')}`,
      };
    default: {
      // PAY_CHANGE_* (requested / approved / rejected / edited / cancelled / forwarded) and LOAN_*.
      const words = action
        .replace(/^PAY_CHANGE_/, 'Pay request ')
        .replace(/^LOAN_/, 'Loan ')
        .replace(/_/g, ' ');
      const type = words.charAt(0) + words.slice(1).toLowerCase();
      const note = c.reviewNote ?? c.note ?? c.reason;
      return {
        type,
        detail: [c.summary, note ? `Note: ${String(note)}` : null]
          .filter(Boolean)
          .join(' · '),
      };
    }
  }
}

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
        'This pay change needs approval: choose President, Founder or Chairman Admin',
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
    return {
      isIncrease,
      summary: `${changes.join(', ') || 'No change'}${when}`,
    };
  }

  async isPackageVerified(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { payPackageVerifiedAt: true },
    });
    return Boolean(employee?.payPackageVerifiedAt);
  }

  /**
   * Finance progress: which staff have their salary package verified, which
   * were changed but not verified yet, and which are untouched.
   */
  async packageStatus() {
    const employees = await this.prisma.employee.findMany({
      where: {
        status: {
          notIn: [
            EmployeeStatus.TERMINATED,
            EmployeeStatus.RESIGNED,
            EmployeeStatus.DISMISSED,
            EmployeeStatus.PENDING_APPROVAL,
          ],
        },
      },
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        status: true,
        currentDesignation: true,
        payPackageVerifiedAt: true,
        currentBranch: { select: { name: true } },
        stipendRecords: {
          select: {
            id: true,
            basicStipend: true,
            lumpsumTotal: true,
            effectiveTo: true,
          },
        },
        payChangeRequests: {
          where: { status: PayChangeStatus.PENDING },
          select: { id: true },
        },
      },
      orderBy: { fullName: 'asc' },
    });
    const recordOwner = new Map<string, string>();
    for (const e of employees)
      for (const r of e.stipendRecords) recordOwner.set(r.id, e.id);
    const logs = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          {
            action: { in: ['SALARY_INCREMENT', 'STIPEND_PACKAGE_CORRECTED'] },
            entityId: { in: [...recordOwner.keys()] },
          },
          {
            action: 'PAY_PACKAGE_VERIFIED',
            entityId: { in: employees.map((e) => e.id) },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        action: true,
        entityId: true,
        createdAt: true,
        user: {
          select: { email: true, employee: { select: { fullName: true } } },
        },
      },
    });
    // Newest first, so the first log seen per employee is the last change.
    const lastChange = new Map<string, (typeof logs)[number]>();
    for (const log of logs) {
      const owner =
        log.action === 'PAY_PACKAGE_VERIFIED'
          ? log.entityId
          : recordOwner.get(log.entityId);
      if (owner && !lastChange.has(owner)) lastChange.set(owner, log);
    }
    const LABEL: Record<string, string> = {
      SALARY_INCREMENT: 'Salary increment',
      STIPEND_PACKAGE_CORRECTED: 'Package edited',
      PAY_PACKAGE_VERIFIED: 'Verified',
    };
    const rows = employees.map((e) => {
      const active = e.stipendRecords.find((r) => r.effectiveTo == null);
      const log = lastChange.get(e.id);
      const state = e.payPackageVerifiedAt
        ? 'VERIFIED'
        : log
          ? 'UPDATED'
          : active
            ? 'NOT_STARTED'
            : 'NO_PACKAGE';
      return {
        employeeId: e.id,
        employeeCode: e.employeeCode,
        fullName: e.fullName,
        designation: e.currentDesignation,
        branch: e.currentBranch?.name ?? null,
        status: e.status,
        basicStipend: active ? Number(active.basicStipend) : null,
        lumpsumTotal:
          active?.lumpsumTotal != null ? Number(active.lumpsumTotal) : null,
        state,
        verifiedAt: e.payPackageVerifiedAt,
        pendingApproval: e.payChangeRequests.length > 0,
        lastChange: log
          ? {
              type: LABEL[log.action] ?? log.action,
              at: log.createdAt,
              by: log.user.employee?.fullName ?? log.user.email,
            }
          : null,
      };
    });
    const count = (s: string) => rows.filter((r) => r.state === s).length;
    return {
      summary: {
        total: rows.length,
        verified: count('VERIFIED'),
        updated: count('UPDATED'),
        notStarted: count('NOT_STARTED'),
        noPackage: count('NO_PACKAGE'),
        pendingApproval: rows.filter((r) => r.pendingApproval).length,
      },
      rows,
    };
  }

  /** Salary amendment history of one employee, newest first, from the audit log. */
  async packageHistory(employeeId: string) {
    const records = await this.prisma.stipendRecord.findMany({
      where: { employeeId },
      select: { id: true },
    });
    const forEmployee = { path: ['employeeId'], equals: employeeId };
    const logs = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          {
            action: { in: ['SALARY_INCREMENT', 'STIPEND_PACKAGE_CORRECTED'] },
            entityId: { in: records.map((r) => r.id) },
          },
          { action: 'PAY_PACKAGE_VERIFIED', entityId: employeeId },
          { action: { startsWith: 'PAY_CHANGE_' }, changes: forEmployee },
          {
            action: {
              in: ['EMPLOYEE_ALLOWANCE_SET', 'EMPLOYEE_ALLOWANCE_ENDED'],
            },
            changes: forEmployee,
          },
          { entity: 'EmployeeLoan', changes: forEmployee },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: {
        id: true,
        action: true,
        createdAt: true,
        changes: true,
        user: {
          select: { email: true, employee: { select: { fullName: true } } },
        },
      },
    });
    return logs.map((log) => ({
      id: log.id,
      at: log.createdAt,
      by: log.user.employee?.fullName ?? log.user.email,
      ...describeAmendment(
        log.action,
        (log.changes ?? {}) as Record<string, unknown>,
      ),
    }));
  }

  /** Finance locks the package: from now on non-executive changes go to the Founder. */
  async verifyPackage(employeeId: string, user: PayActor) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { payPackageVerifiedAt: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.payPackageVerifiedAt) {
      throw new BadRequestException('This package is already verified');
    }
    const active = await this.prisma.stipendRecord.findFirst({
      where: { employeeId, effectiveTo: null },
      select: { id: true },
    });
    if (!active) {
      throw new BadRequestException('No stipend package to verify');
    }
    const verifiedAt = new Date();
    await this.prisma.employee.update({
      where: { id: employeeId },
      data: {
        payPackageVerifiedAt: verifiedAt,
        payPackageVerifiedById: user.id,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'PAY_PACKAGE_VERIFIED',
        entity: 'Employee',
        entityId: employeeId,
        changes: { stipendRecordId: active.id },
      },
    });
    return { employeeId, payPackageVerifiedAt: verifiedAt };
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
      select: {
        month: true,
        year: true,
        stipendRecord: { select: { employeeId: true } },
      },
    });
    if (!entry) throw new NotFoundException('Payroll entry not found');
    const what =
      dto.amount != null ? pkr(dto.amount) : `${dto.hours} extra hours`;
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
      ? await this.prisma.incentiveType.findUnique({
          where: { id: dto.typeId },
        })
      : null;
    const what = type?.name ?? dto.reason?.trim() ?? 'Incentive';
    return `Incentive (${what}) ${pkr(dto.amount)} for ${monthLabel(dto.year, dto.month)}`;
  }

  /** "Incentive change: On Progress 1,500 (Sep 2026) -> (On Progress) 2,000 for Sep 2026". */
  async describeIncentiveChange(
    current: { reason: string; amount: unknown; month: number; year: number },
    dto: {
      typeId?: string;
      reason?: string;
      amount: number;
      month: number;
      year: number;
    },
  ) {
    const next = (await this.describeIncentive(dto)).replace(/^Incentive /, '');
    return `Incentive change: ${current.reason} ${pkr(Number(current.amount))} (${monthLabel(current.year, current.month)}) → ${next}`;
  }

  /**
   * Finance corrects a pending incentive request before the executive decides:
   * new values, possibly another executive. It stays pending.
   */
  async editIncentiveRequest(
    id: string,
    user: PayActor,
    dto: {
      amount: number;
      typeId?: string;
      reason?: string;
      month: number;
      year: number;
      approverTarget: EmployeeApproverTarget;
    },
  ) {
    const request = await this.getPending(id);
    if (request.kind !== PayChangeKind.INCENTIVE) {
      throw new BadRequestException(
        'Only incentive requests can be edited; cancel this one and send a new request',
      );
    }
    const old = request.payload as Record<string, unknown>;
    const { approverTarget, ...values } = dto;
    const payload = {
      ...values,
      ...(old.incentiveId
        ? { incentiveId: old.incentiveId }
        : { employeeId: request.employeeId }),
    };
    let summary: string;
    if (old.incentiveId) {
      const current = await this.prisma.incentive.findUnique({
        where: { id: String(old.incentiveId) },
      });
      if (!current) {
        throw new NotFoundException(
          'The incentive being changed no longer exists; cancel this request',
        );
      }
      if (dto.amount <= Number(current.amount)) {
        throw new BadRequestException(
          'This no longer raises the incentive; cancel the request and edit the incentive directly',
        );
      }
      summary = await this.describeIncentiveChange(current, dto);
    } else {
      summary = await this.describeIncentive(dto);
    }
    const { count } = await this.prisma.payChangeRequest.updateMany({
      where: { id, status: PayChangeStatus.PENDING },
      data: {
        payload: {
          ...payload,
          _editedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
        summary,
        reason: dto.reason?.trim() || null,
        approverTarget,
      },
    });
    if (count === 0)
      throw new BadRequestException('This request has already been decided');
    await this.audit(user, 'PAY_CHANGE_EDITED', request, {
      before: request.summary,
      after: summary,
      approverTarget,
    });
    return this.prisma.payChangeRequest.findUnique({
      where: { id },
      include: this.include,
    });
  }

  /** The sender (Finance) withdraws a pending request; the reason is kept. */
  async cancel(id: string, user: PayActor, reason: string) {
    const request = await this.getPending(id);
    if (!(await this.claim(id, PayChangeStatus.CANCELLED, user, reason))) {
      throw new BadRequestException('This request has already been decided');
    }
    await this.audit(user, 'PAY_CHANGE_CANCELLED', request, {
      reason: reason.trim(),
    });
    return { id, status: PayChangeStatus.CANCELLED };
  }

  private readonly include = {
    employee: {
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        currentDesignation: true,
        status: true,
        statusEffectiveFrom: true,
        currentBranch: { select: { name: true } },
      },
    },
    submittedBy: {
      select: {
        id: true,
        email: true,
        employee: { select: { fullName: true } },
      },
    },
    reviewedBy: {
      select: {
        id: true,
        email: true,
        employee: { select: { fullName: true } },
      },
    },
  } satisfies Prisma.PayChangeRequestInclude;

  /**
   * Executives see their own queue; IT / HR / Accounts / Super Admin see all.
   * Pending rows carry the month's pay (basic, allowances, incentives,
   * deductions, net) and why an approval would fail, so the executive
   * decides with the numbers in front of them.
   */
  async list(
    query: { status?: PayChangeStatus; employeeId?: string },
    user: PayActor,
  ) {
    const target = approverTargetForUserRole(user.role);
    const status = query.status ?? PayChangeStatus.PENDING;
    const rows = await this.prisma.payChangeRequest.findMany({
      where: {
        status,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(target ? { approverTarget: target } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: this.include,
      take: 500,
    });
    if (status !== PayChangeStatus.PENDING || rows.length === 0) return rows;
    return this.withPayContext(rows);
  }

  private async withPayContext<
    T extends {
      kind: PayChangeKind;
      employeeId: string;
      payload: Prisma.JsonValue;
      employee: { status: string; statusEffectiveFrom: Date | null } | null;
    },
  >(rows: T[]) {
    const months = rows.map((r) => requestPayMonth(r.payload));
    const keys = [
      ...new Map(
        rows.flatMap((r, i) => {
          const m = months[i];
          return m
            ? [
                [
                  `${r.employeeId}|${m.year}|${m.month}`,
                  { employeeId: r.employeeId, ...m },
                ] as const,
              ]
            : [];
        }),
      ).values(),
    ];
    const [entries, incentives] = keys.length
      ? await Promise.all([
          this.prisma.payrollEntry.findMany({
            where: {
              OR: keys.map((k) => ({
                month: k.month,
                year: k.year,
                stipendRecord: { employeeId: k.employeeId },
              })),
            },
            select: {
              month: true,
              year: true,
              status: true,
              basicStipend: true,
              totalAllowances: true,
              totalDeductions: true,
              netStipend: true,
              stipendRecord: {
                select: {
                  employeeId: true,
                  basicStipend: true,
                  effectiveTo: true,
                },
              },
            },
          }),
          this.prisma.incentive.groupBy({
            by: ['employeeId', 'month', 'year'],
            where: {
              OR: keys.map((k) => ({
                employeeId: k.employeeId,
                month: k.month,
                year: k.year,
              })),
            },
            _sum: { amount: true },
          }),
        ])
      : [[], []];
    const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
    return rows.map((r, i) => {
      const m = months[i];
      const segs = m
        ? entries.filter(
            (e) =>
              e.stipendRecord.employeeId === r.employeeId &&
              e.month === m.month &&
              e.year === m.year,
          )
        : [];
      const sum = (f: (e: (typeof segs)[number]) => unknown) =>
        num(segs.reduce((s, e) => s + (Number(f(e)) || 0), 0));
      const contract =
        segs.find((e) => e.stipendRecord.effectiveTo == null) ?? segs[0];
      const closed = segs.find((e) => e.status !== 'PENDING');
      const pay =
        m && segs.length
          ? {
              month: m.month,
              year: m.year,
              status: closed ? closed.status : 'PENDING',
              contractBasic: num(contract?.stipendRecord.basicStipend),
              earnedBasic: sum((e) => e.basicStipend),
              allowances: sum((e) => e.totalAllowances),
              incentives: num(
                incentives.find(
                  (g) =>
                    g.employeeId === r.employeeId &&
                    g.month === m.month &&
                    g.year === m.year,
                )?._sum.amount,
              ),
              deductions: sum((e) => e.totalDeductions),
              net: sum((e) => e.netStipend),
            }
          : null;
      return { ...r, pay, blockedReason: approvalBlockedReason(r) };
    });
  }

  async getPending(id: string) {
    const request = await this.prisma.payChangeRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundException('Pay change request not found');
    if (request.status !== PayChangeStatus.PENDING) {
      throw new BadRequestException('This request has already been decided');
    }
    return request;
  }

  assertCanReview(user: PayActor, approverTarget: EmployeeApproverTarget) {
    const roles = user.roles?.length ? user.roles : [user.role];
    if (roles.includes(UserRole.SUPER_ADMIN)) return;
    if (roles.some((r) => approverTargetForUserRole(r) === approverTarget))
      return;
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
    if (count === 0)
      throw new BadRequestException('This request has already been decided');
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
    request: {
      id: string;
      kind: PayChangeKind;
      employeeId: string;
      summary: string;
    },
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

/** Payroll month a request touches (incentives / additions carry month+year; packages a start date). */
export function requestPayMonth(
  payload: Prisma.JsonValue,
): { year: number; month: number } | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (Number(p.month) >= 1 && Number(p.year) >= 2000)
    return { year: Number(p.year), month: Number(p.month) };
  const iso = (p.effectiveFrom ?? p.startMonth) as string | undefined;
  if (!iso) return null;
  const [y, mo] = String(iso).slice(0, 7).split('-').map(Number);
  return y && mo ? { year: y, month: mo } : null;
}

/**
 * Why approving would fail: incentives are only for active / appointed
 * staff (On Rest, Resigned, ... count as left).
 */
export function approvalBlockedReason(r: {
  kind: PayChangeKind;
  employee: { status: string; statusEffectiveFrom: Date | null } | null;
}): string | null {
  if (r.kind !== PayChangeKind.INCENTIVE || !r.employee) return null;
  const { status, statusEffectiveFrom } = r.employee;
  if (status === 'ACTIVE' || status === 'APPOINTED') return null;
  const since = statusEffectiveFrom
    ? ` since ${statusEffectiveFrom.toISOString().slice(0, 10)}`
    : '';
  return `${status.replace(/_/g, ' ')}${since}: incentives are only for active staff. HR must reinstate the employee first, otherwise reject this request.`;
}
