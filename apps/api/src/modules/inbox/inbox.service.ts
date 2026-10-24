import { Injectable } from '@nestjs/common';
import {
  EmployeeChangeKind,
  EmployeeChangeStatus,
  ExtraTimeStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAnyRole } from '../../common/user-roles.util';

export type InboxTab = 'todo' | 'sent' | 'done';
type Actor = { id: string; roles: UserRole[] };

export type InboxItem = {
  key: string;
  type: 'EXTRA_DAY' | 'OVERTIME' | 'TRANSFER' | 'WORKING_HOURS';
  id: string;
  /** Which existing approve / reject endpoint decides it. */
  kind: 'day' | 'overtime' | 'change';
  employee: { id: string; name: string; code: string; branch: string | null };
  date: string;
  minutes: number | null;
  note: string | null;
  status: string;
  step: string;
  requestedBy: string | null;
  canDecide: boolean;
  trail: Array<{
    at: string | null;
    by: string | null;
    text: string;
    note: string | null;
  }>;
};

const STEP: Record<ExtraTimeStatus, string> = {
  PENDING: 'With HR Operations',
  ESCALATED: 'With Chairman',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
const DECISION_TEXT: Record<string, string> = {
  EXTRA_TIME_ESCALATED: 'HR Operations approved; sent to the Chairman',
  EXTRA_TIME_APPROVED: 'Approved (final)',
  EXTRA_TIME_REJECTED: 'Rejected',
};
/** History window for Sent / Done. */
const DAYS_BACK = 90;
const MAX_ROWS = 300;

/**
 * One Inbox for every login: what waits for me, what I sent and where it is
 * now, and what I decided. Phase 1 covers extra days and overtime; it only
 * reads the existing tables, each workflow keeps its own rules.
 */
@Injectable()
export class InboxService {
  constructor(private prisma: PrismaService) {}

  async list(actor: Actor, tab: InboxTab) {
    const since = new Date(Date.now() - DAYS_BACK * 86_400_000);
    const hrOps = hasAnyRole(actor.roles, [
      UserRole.HR_OPERATIONS_MANAGER,
      UserRole.SUPER_ADMIN,
    ]);
    const chairman = hasAnyRole(actor.roles, [
      UserRole.CHAIRMAN,
      UserRole.SUPER_ADMIN,
    ]);

    const changes = await this.changeItems(actor, tab, since, hrOps);
    let dayWhere: Prisma.AdditionalWorkingDayWhereInput;
    let otWhere: Prisma.AttendanceLogWhereInput;
    if (tab === 'todo') {
      const statuses = [
        ...(hrOps ? [ExtraTimeStatus.PENDING] : []),
        ...(chairman ? [ExtraTimeStatus.ESCALATED] : []),
      ];
      if (!statuses.length) return { tab, items: changes };
      dayWhere = { status: { in: statuses }, NOT: { addedById: actor.id } };
      otWhere = {
        overtimeStatus: { in: statuses },
        NOT: { overtimeRequestedById: actor.id },
      };
    } else if (tab === 'sent') {
      dayWhere = { addedById: actor.id, createdAt: { gte: since } };
      otWhere = {
        overtimeRequestedById: actor.id,
        overtimeStatus: { not: null },
        date: { gte: since },
      };
    } else {
      const decided = await this.prisma.auditLog.findMany({
        where: {
          userId: actor.id,
          action: { startsWith: 'EXTRA_TIME_' },
          createdAt: { gte: since },
        },
        select: { entity: true, entityId: true },
        take: MAX_ROWS,
      });
      const ids = (entity: string) =>
        decided.filter((d) => d.entity === entity).map((d) => d.entityId);
      dayWhere = { id: { in: ids('AdditionalWorkingDay') } };
      otWhere = { id: { in: ids('AttendanceLog') } };
    }

    const employee = {
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        currentBranch: { select: { name: true } },
      },
    };
    const [days, logs] = await Promise.all([
      this.prisma.additionalWorkingDay.findMany({
        where: dayWhere,
        include: { employee, addedBy: { select: { email: true } } },
        orderBy: { date: 'desc' },
        take: MAX_ROWS,
      }),
      this.prisma.attendanceLog.findMany({
        where: otWhere,
        include: { employee },
        orderBy: { date: 'desc' },
        take: MAX_ROWS,
      }),
    ]);

    // Trail: decisions from the audit log; overtime entry time from the requester's attendance edit.
    const entityIds = [...days.map((d) => d.id), ...logs.map((l) => l.id)];
    const audits = entityIds.length
      ? await this.prisma.auditLog.findMany({
          where: { entityId: { in: entityIds } },
          select: {
            entityId: true,
            action: true,
            userId: true,
            createdAt: true,
            changes: true,
            user: { select: { email: true } },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const requesterIds = [
      ...new Set(logs.map((l) => l.overtimeRequestedById).filter(Boolean)),
    ] as string[];
    const requesters = requesterIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: requesterIds } },
          select: { id: true, email: true },
        })
      : [];
    const emailOf = new Map(requesters.map((u) => [u.id, u.email]));

    const decisions = (id: string) =>
      audits
        .filter((a) => a.entityId === id && DECISION_TEXT[a.action])
        .map((a) => ({
          at: a.createdAt.toISOString(),
          by: a.user?.email ?? null,
          text: DECISION_TEXT[a.action],
          note: ((a.changes as { note?: string } | null)?.note ?? null) || null,
        }));
    const canDecide = (status: ExtraTimeStatus, enteredBy: string | null) =>
      enteredBy !== actor.id &&
      ((status === ExtraTimeStatus.PENDING && hrOps) ||
        (status === ExtraTimeStatus.ESCALATED && chairman));
    const emp = (e: (typeof days)[number]['employee']) => ({
      id: e.id,
      name: e.fullName,
      code: e.employeeCode,
      branch: e.currentBranch?.name ?? null,
    });
    const waiting = (status: ExtraTimeStatus) =>
      status === ExtraTimeStatus.PENDING || status === ExtraTimeStatus.ESCALATED
        ? [{ at: null, by: null, text: `Waiting: ${STEP[status]}`, note: null }]
        : [];

    const items: InboxItem[] = [
      ...days.map((d) => ({
        key: `day:${d.id}`,
        type: 'EXTRA_DAY' as const,
        id: d.id,
        kind: 'day' as const,
        employee: emp(d.employee),
        date: d.date.toISOString().slice(0, 10),
        minutes: null,
        note: d.note,
        status: d.status,
        step: STEP[d.status],
        requestedBy: d.addedBy.email,
        canDecide: canDecide(d.status, d.addedById),
        trail: [
          {
            at: d.createdAt.toISOString(),
            by: d.addedBy.email,
            text: 'Extra day entered',
            note: d.note,
          },
          ...decisions(d.id),
          ...waiting(d.status),
        ],
      })),
      ...logs.map((l) => {
        const status = l.overtimeStatus!;
        const by = l.overtimeRequestedById
          ? (emailOf.get(l.overtimeRequestedById) ?? null)
          : null;
        const entered = audits.find(
          (a) => a.entityId === l.id && a.userId === l.overtimeRequestedById,
        );
        return {
          key: `overtime:${l.id}`,
          type: 'OVERTIME' as const,
          id: l.id,
          kind: 'overtime' as const,
          employee: emp(l.employee),
          date: l.date.toISOString().slice(0, 10),
          minutes: l.overtimeMinutes,
          note: l.note,
          status,
          step: STEP[status],
          requestedBy: by,
          canDecide: canDecide(status, l.overtimeRequestedById),
          trail: [
            {
              at: entered?.createdAt.toISOString() ?? null,
              by,
              text: `Overtime entered (${l.overtimeMinutes} min)`,
              note: null,
            },
            ...decisions(l.id),
            ...waiting(status),
          ],
        };
      }),
      ...changes,
    ].sort((a, b) => b.date.localeCompare(a.date));

    return { tab, items };
  }

  /** Transfer and working-hours requests (EmployeeChangeRequest); HR Operations decides. */
  private async changeItems(
    actor: Actor,
    tab: InboxTab,
    since: Date,
    hrOps: boolean,
  ): Promise<InboxItem[]> {
    const where: Prisma.EmployeeChangeRequestWhereInput =
      tab === 'todo'
        ? {
            status: EmployeeChangeStatus.PENDING,
            ...(actor.roles.includes(UserRole.SUPER_ADMIN)
              ? {}
              : { NOT: { requestedById: actor.id } }),
          }
        : tab === 'sent'
          ? { requestedById: actor.id, requestedAt: { gte: since } }
          : { decidedById: actor.id, decidedAt: { gte: since } };
    if (tab === 'todo' && !hrOps) return [];
    const rows = await this.prisma.employeeChangeRequest.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            currentBranch: { select: { name: true } },
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: MAX_ROWS,
    });
    const userIds = [
      ...new Set(
        rows.flatMap((r) => [r.requestedById, r.decidedById]).filter(Boolean),
      ),
    ] as string[];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true },
        })
      : [];
    const email = (id: string | null) =>
      (id && users.find((u) => u.id === id)?.email) || null;
    const label = (k: EmployeeChangeKind) =>
      k === EmployeeChangeKind.TRANSFER ? 'Transfer' : 'Working hours';
    return rows.map((r) => {
      const effective = (r.payload as { effectiveDate?: string } | null)
        ?.effectiveDate;
      const pending = r.status === EmployeeChangeStatus.PENDING;
      return {
        key: `change:${r.id}`,
        type: r.kind,
        id: r.id,
        kind: 'change' as const,
        employee: {
          id: r.employee.id,
          name: r.employee.fullName,
          code: r.employee.employeeCode,
          branch: r.employee.currentBranch?.name ?? null,
        },
        date: (effective ?? r.requestedAt.toISOString()).slice(0, 10),
        minutes: null,
        note: r.summary,
        status: r.status,
        step: pending
          ? 'With HR Operations'
          : r.status === EmployeeChangeStatus.APPROVED
            ? 'Approved'
            : 'Rejected',
        requestedBy: email(r.requestedById),
        canDecide:
          pending &&
          hrOps &&
          (r.requestedById !== actor.id ||
            actor.roles.includes(UserRole.SUPER_ADMIN)),
        trail: [
          {
            at: r.requestedAt.toISOString(),
            by: email(r.requestedById),
            text: `${label(r.kind)} requested (draft letter in Letters)`,
            note: null,
          },
          ...(r.decidedAt
            ? [
                {
                  at: r.decidedAt.toISOString(),
                  by: email(r.decidedById),
                  text:
                    r.status === EmployeeChangeStatus.APPROVED
                      ? 'Approved; change applied'
                      : 'Rejected; nothing changed',
                  note: r.decisionNote,
                },
              ]
            : []),
          ...(pending
            ? [
                {
                  at: null,
                  by: null,
                  text: 'Waiting: With HR Operations',
                  note: null,
                },
              ]
            : []),
        ],
      };
    });
  }

  /** Badge on the sidebar: how many items wait for this login. */
  async todoCount(actor: Actor) {
    const { items } = await this.list(actor, 'todo');
    return { todo: items.length };
  }
}
