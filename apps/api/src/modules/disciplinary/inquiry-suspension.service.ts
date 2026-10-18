import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceLogType,
  AttendanceStatus,
  DisciplinaryStatus,
  DisciplinaryType,
  EmployeeStatus,
  InquirySuspendStatus,
  LetterStatus,
  LetterType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAnyRole } from '../../common/user-roles.util';
import { LettersService } from '../letters/letters.service';
import { toPakistanDateOnly } from '../attendance/attendance-late.util';
import { isWeeklyOffDate } from '../attendance/weekly-off.util';

/** Req 9: may press "Suspend" inside an inquiry. */
export const INQUIRY_SUSPEND_REQUEST_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.CHAIRMAN,
  UserRole.PRESIDENT,
  UserRole.FOUNDER,
];
/** Executives approve; an executive's own request applies at once. */
export const INQUIRY_SUSPEND_APPROVER_ROLES: UserRole[] = [
  UserRole.CHAIRMAN,
  UserRole.PRESIDENT,
  UserRole.FOUNDER,
];

/** Req 10: consecutive uninformed absences that suspend automatically. */
export const AUTO_SUSPEND_AFTER_UNINFORMED_DAYS = 3;

type Actor = { id: string; roles: UserRole[] };
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Req 10: the run of uninformed absences ending on `date` (newest first).
 * Weekly offs / holidays (or no row on a weekly off) are skipped; any other
 * day ends the run.
 */
export function uninformedAbsenceRun(
  logs: Array<{ date: Date; status: AttendanceStatus }>,
  date: Date,
  weeklyOffWeekdays: number[] | null | undefined,
  maxDaysBack = 14,
): Date[] {
  const byDay = new Map(logs.map((l) => [day(l.date), l.status]));
  const run: Date[] = [];
  const d = new Date(date);
  for (let i = 0; i < maxDaysBack; i++) {
    const status = byDay.get(day(d));
    if (status === AttendanceStatus.UNINFORMED_ABSENT) run.push(new Date(d));
    else if (
      status === AttendanceStatus.HOLIDAY ||
      (status === undefined && isWeeklyOffDate(weeklyOffWeekdays, d))
    ) {
      // off day: keep counting past it
    } else break;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return run;
}

/**
 * Phase 2 Req 9 (suspend from an inquiry, executive approval) and Req 10
 * (automatic suspension after 3 consecutive uninformed absences). Both end in
 * `applySuspension`: status SUSPENDED from a date (pay stops from it), a
 * Suspension Notice letter, the record and notifications.
 */
@Injectable()
export class InquirySuspensionService {
  private readonly logger = new Logger(InquirySuspensionService.name);

  constructor(
    private prisma: PrismaService,
    private letters: LettersService,
  ) {}

  async request(
    inquiryId: string,
    dto: { suspendFrom: string; reason: string; approverUserId?: string },
    actor: Actor,
  ) {
    if (!hasAnyRole(actor.roles, INQUIRY_SUSPEND_REQUEST_ROLES)) {
      throw new ForbiddenException('You cannot suspend from an inquiry');
    }
    const inquiry = await this.load(inquiryId);
    const employee = inquiry.disciplinaryAction.employee;
    if (inquiry.closedAt) throw new BadRequestException('This inquiry is closed');
    if (employee.status === EmployeeStatus.SUSPENDED) {
      throw new BadRequestException('The employee is already suspended');
    }
    if (inquiry.suspendStatus === InquirySuspendStatus.PENDING_APPROVAL) {
      throw new BadRequestException('A suspension is already waiting for approval');
    }
    const suspendFrom = toPakistanDateOnly(new Date(dto.suspendFrom));
    const reason = dto.reason.trim();
    const now = new Date();
    const isExecutive = hasAnyRole(actor.roles, [
      ...INQUIRY_SUSPEND_APPROVER_ROLES,
      UserRole.SUPER_ADMIN,
    ]);

    if (!isExecutive) {
      const approver = dto.approverUserId
        ? await this.prisma.user.findUnique({
            where: { id: dto.approverUserId },
            include: { additionalRoles: true },
          })
        : null;
      const approverRoles = approver
        ? [approver.role, ...approver.additionalRoles.map((r) => r.role)]
        : [];
      if (!approver?.isActive || !hasAnyRole(approverRoles, INQUIRY_SUSPEND_APPROVER_ROLES)) {
        throw new BadRequestException('Choose the Chairman, President or Founder to approve');
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.inquiry.update({
          where: { id: inquiryId },
          data: {
            suspendStatus: InquirySuspendStatus.PENDING_APPROVAL,
            suspendFrom,
            suspendReason: reason,
            suspendRequestedById: actor.id,
            suspendRequestedAt: now,
            suspendApproverUserId: approver.id,
            suspendDecidedById: null,
            suspendDecidedAt: null,
            suspendDecisionNote: null,
          },
        });
        if (approver.employeeId) {
          await tx.notification.create({
            data: {
              employeeId: approver.employeeId,
              type: 'INQUIRY_SUSPEND_PENDING',
              message: `Suspension of ${employee.fullName} (${employee.employeeCode ?? ''}) from ${day(suspendFrom)} awaits your approval. Reason: ${reason}`,
            },
          });
        }
        await this.audit(tx, actor.id, 'INQUIRY_SUSPEND_REQUESTED', inquiryId, {
          employeeId: employee.id,
          suspendFrom: day(suspendFrom),
          reason,
          approverUserId: approver.id,
        });
      });
      return { status: InquirySuspendStatus.PENDING_APPROVAL };
    }

    await this.prisma.inquiry.update({
      where: { id: inquiryId },
      data: {
        suspendStatus: InquirySuspendStatus.APPROVED,
        suspendFrom,
        suspendReason: reason,
        suspendRequestedById: actor.id,
        suspendRequestedAt: now,
        suspendApproverUserId: actor.id,
        suspendDecidedById: actor.id,
        suspendDecidedAt: now,
      },
    });
    return this.applySuspension({
      employeeId: employee.id,
      from: suspendFrom,
      reason,
      inquiryId,
      disciplinaryActionId: inquiry.disciplinaryActionId,
      actorUserId: actor.id,
    });
  }

  async decide(inquiryId: string, approve: boolean, actor: Actor, note?: string) {
    const inquiry = await this.load(inquiryId);
    if (inquiry.suspendStatus !== InquirySuspendStatus.PENDING_APPROVAL) {
      throw new BadRequestException('No suspension is waiting for approval');
    }
    if (inquiry.suspendApproverUserId !== actor.id && !actor.roles.includes(UserRole.SUPER_ADMIN)) {
      throw new ForbiddenException('Only the selected approver can decide this suspension');
    }
    const now = new Date();
    const claimed = await this.prisma.inquiry.updateMany({
      where: { id: inquiryId, suspendStatus: InquirySuspendStatus.PENDING_APPROVAL },
      data: {
        suspendStatus: approve ? InquirySuspendStatus.APPROVED : InquirySuspendStatus.REJECTED,
        suspendDecidedById: actor.id,
        suspendDecidedAt: now,
        suspendDecisionNote: note?.trim() || null,
      },
    });
    if (claimed.count !== 1) throw new BadRequestException('Already decided');
    const employee = inquiry.disciplinaryAction.employee;
    if (!approve) {
      await this.prisma.$transaction(async (tx) => {
        await this.audit(tx, actor.id, 'INQUIRY_SUSPEND_REJECTED', inquiryId, {
          employeeId: employee.id,
          note: note?.trim() || null,
        });
        const requester = inquiry.suspendRequestedById
          ? await tx.user.findUnique({ where: { id: inquiry.suspendRequestedById } })
          : null;
        if (requester?.employeeId) {
          await tx.notification.create({
            data: {
              employeeId: requester.employeeId,
              type: 'INQUIRY_SUSPEND_REJECTED',
              message: `Suspension of ${employee.fullName} was not approved.${note ? ` ${note}` : ''}`,
            },
          });
        }
      });
      return { status: InquirySuspendStatus.REJECTED };
    }
    return this.applySuspension({
      employeeId: employee.id,
      from: inquiry.suspendFrom ?? toPakistanDateOnly(now),
      reason: inquiry.suspendReason ?? 'Inquiry',
      inquiryId,
      disciplinaryActionId: inquiry.disciplinaryActionId,
      actorUserId: actor.id,
    });
  }

  /** Suspensions waiting for this executive (or all, for Super Admin). */
  pendingFor(actor: Actor) {
    return this.prisma.inquiry.findMany({
      where: {
        suspendStatus: InquirySuspendStatus.PENDING_APPROVAL,
        ...(actor.roles.includes(UserRole.SUPER_ADMIN) ? {} : { suspendApproverUserId: actor.id }),
      },
      select: {
        id: true,
        suspendFrom: true,
        suspendReason: true,
        suspendRequestedAt: true,
        disciplinaryAction: {
          select: {
            reason: true,
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                currentBranch: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { suspendRequestedAt: 'asc' },
    });
  }

  /**
   * Req 10: called when a day becomes UNINFORMED_ABSENT. On the third
   * consecutive one (weekly offs / holidays skipped) an ACTIVE employee is
   * suspended from the first absent day of the run, with a suspension case
   * opened for the record.
   */
  async autoSuspendOnUninformedAbsence(employeeId: string, date: Date) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, status: true, weeklyOffWeekdays: true },
    });
    if (employee?.status !== EmployeeStatus.ACTIVE) return null;
    const from = new Date(date);
    from.setUTCDate(from.getUTCDate() - 14);
    const logs = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId,
        type: AttendanceLogType.REGULAR,
        date: { gte: from, lte: date },
      },
      select: { date: true, status: true },
    });
    const run = uninformedAbsenceRun(logs, date, employee.weeklyOffWeekdays);
    if (run.length < AUTO_SUSPEND_AFTER_UNINFORMED_DAYS) return null;
    const firstDay = run[run.length - 1];
    const reason = `${run.length} consecutive uninformed absences (${day(firstDay)} to ${day(run[0])})`;

    const existing = await this.prisma.disciplinaryAction.findFirst({
      where: {
        employeeId,
        type: DisciplinaryType.SUSPENSION,
        status: { in: [DisciplinaryStatus.OPEN, DisciplinaryStatus.UNDER_INQUIRY] },
      },
      include: { inquiry: true },
    });
    const now = new Date();
    const deadlineAt = new Date(now.getTime() + 3 * 86_400_000);
    const action =
      existing ??
      (await this.prisma.disciplinaryAction.create({
        data: {
          employeeId,
          type: DisciplinaryType.SUSPENSION,
          reason: `Automatic: ${reason}`,
          status: DisciplinaryStatus.UNDER_INQUIRY,
          inquiry: {
            create: {
              deadlineAt,
              durationDays: 3,
              officiallyOpenedAt: now,
              notes: 'Opened automatically after consecutive uninformed absences',
            },
          },
        },
        include: { inquiry: true },
      }));
    if (existing && !existing.inquiry) {
      await this.prisma.inquiry.create({
        data: { disciplinaryActionId: existing.id, deadlineAt, durationDays: 3, officiallyOpenedAt: now },
      });
    }
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { disciplinaryActionId: action.id },
    });
    if (inquiry) {
      await this.prisma.inquiry.update({
        where: { id: inquiry.id },
        data: {
          suspendStatus: InquirySuspendStatus.APPROVED,
          suspendFrom: firstDay,
          suspendReason: `Automatic: ${reason}`,
          suspendRequestedAt: now,
          suspendDecidedAt: now,
        },
      });
    }
    return this.applySuspension({
      employeeId,
      from: firstDay,
      reason: `Automatic: ${reason}`,
      inquiryId: inquiry?.id ?? null,
      disciplinaryActionId: action.id,
      actorUserId: null,
    });
  }

  private async applySuspension(p: {
    employeeId: string;
    from: Date;
    reason: string;
    inquiryId: string | null;
    disciplinaryActionId: string;
    actorUserId: string | null;
  }) {
    const employee = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.employee.updateMany({
        where: { id: p.employeeId, status: { not: EmployeeStatus.SUSPENDED } },
        data: { status: EmployeeStatus.SUSPENDED, statusEffectiveFrom: p.from },
      });
      if (claimed.count !== 1) throw new BadRequestException('The employee is already suspended');
      await tx.disciplinaryAction.update({
        where: { id: p.disciplinaryActionId },
        data: { status: DisciplinaryStatus.UNDER_INQUIRY },
      });
      const emp = await tx.employee.findUniqueOrThrow({
        where: { id: p.employeeId },
        select: { id: true, fullName: true, employeeCode: true },
      });
      await tx.notification.create({
        data: {
          employeeId: p.employeeId,
          type: 'SUSPENDED',
          message: `You are suspended from ${day(p.from)} until the inquiry is closed. Reason: ${p.reason}`,
        },
      });
      const hr = await tx.user.findMany({
        where: {
          isActive: true,
          employeeId: { not: null },
          OR: [
            { role: { in: [UserRole.HR_OPERATIONS_MANAGER, UserRole.HR_MANAGER] } },
            {
              additionalRoles: {
                some: { role: { in: [UserRole.HR_OPERATIONS_MANAGER, UserRole.HR_MANAGER] } },
              },
            },
          ],
        },
        select: { employeeId: true },
      });
      for (const u of hr) {
        await tx.notification.create({
          data: {
            employeeId: u.employeeId!,
            type: 'EMPLOYEE_SUSPENDED',
            message: `${emp.fullName} (${emp.employeeCode ?? ''}) is suspended from ${day(p.from)}. ${p.reason}`,
          },
        });
      }
      if (p.actorUserId) {
        await this.audit(tx, p.actorUserId, 'EMPLOYEE_SUSPENDED', p.inquiryId ?? p.disciplinaryActionId, {
          employeeId: p.employeeId,
          suspendFrom: day(p.from),
          reason: p.reason,
        });
      }
      return emp;
    });

    // The notice is issued straight away (portal + WhatsApp like other sent letters).
    let letterId: string | null = null;
    try {
      const letter = await this.letters.generateSystemLetter(
        {
          employeeId: p.employeeId,
          letterType: LetterType.SUSPENSION,
          extraFields: {
            disciplinaryActionId: p.disciplinaryActionId,
            suspensionReason: p.reason,
            suspensionStartDate: day(p.from),
            suspensionDuration: 'Until the inquiry is closed',
          },
        },
        p.actorUserId ?? 'SYSTEM',
      );
      letterId = letter.letter.id;
      await this.prisma.letter.update({
        where: { id: letterId },
        data: { status: LetterStatus.SENT },
      });
      if (p.inquiryId) {
        await this.prisma.inquiry.update({
          where: { id: p.inquiryId },
          data: { suspendLetterId: letterId },
        });
      }
    } catch (err) {
      // Status is already changed; HR can still issue the notice from Letters.
      this.logger.error(`Suspension notice for ${p.employeeId} failed: ${String(err)}`);
    }
    return { status: InquirySuspendStatus.APPROVED, employeeId: employee.id, letterId };
  }

  private async load(inquiryId: string) {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      include: {
        disciplinaryAction: {
          include: {
            employee: { select: { id: true, fullName: true, employeeCode: true, status: true } },
          },
        },
      },
    });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    return inquiry;
  }

  private audit(
    tx: Prisma.TransactionClient,
    userId: string,
    action: string,
    entityId: string,
    changes: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: { userId, action, entity: 'Inquiry', entityId, changes },
    });
  }
}
