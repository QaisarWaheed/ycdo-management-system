import { Injectable } from '@nestjs/common';
import { ExtraTimeStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAnyRole } from '../../common/user-roles.util';

export type InboxTab = 'todo' | 'sent' | 'done';
type Actor = { id: string; roles: UserRole[] };

export type InboxItem = {
  key: string;
  type: 'EXTRA_DAY' | 'OVERTIME';
  id: string;
  /** Route kind for the existing extra-time approve / reject endpoints. */
  kind: 'day' | 'overtime';
  employee: { id: string; name: string; code: string; branch: string | null };
  date: string;
  minutes: number | null;
  note: string | null;
  status: string;
  step: string;
  requestedBy: string | null;
  canDecide: boolean;
  trail: Array<{ at: string | null; by: string | null; text: string; note: string | null }>;
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
    const hrOps = hasAnyRole(actor.roles, [UserRole.HR_OPERATIONS_MANAGER, UserRole.SUPER_ADMIN]);
    const chairman = hasAnyRole(actor.roles, [UserRole.CHAIRMAN, UserRole.SUPER_ADMIN]);

    let dayWhere: Prisma.AdditionalWorkingDayWhereInput;
    let otWhere: Prisma.AttendanceLogWhereInput;
    if (tab === 'todo') {
      const statuses = [
        ...(hrOps ? [ExtraTimeStatus.PENDING] : []),
        ...(chairman ? [ExtraTimeStatus.ESCALATED] : []),
      ];
      if (!statuses.length) return { tab, items: [] as InboxItem[] };
      dayWhere = { status: { in: statuses }, NOT: { addedById: actor.id } };
      otWhere = { overtimeStatus: { in: statuses }, NOT: { overtimeRequestedById: actor.id } };
    } else if (tab === 'sent') {
      dayWhere = { addedById: actor.id, createdAt: { gte: since } };
      otWhere = { overtimeRequestedById: actor.id, overtimeStatus: { not: null }, date: { gte: since } };
    } else {
      const decided = await this.prisma.auditLog.findMany({
        where: { userId: actor.id, action: { startsWith: 'EXTRA_TIME_' }, createdAt: { gte: since } },
        select: { entity: true, entityId: true },
        take: MAX_ROWS,
      });
      const ids = (entity: string) => decided.filter((d) => d.entity === entity).map((d) => d.entityId);
      dayWhere = { id: { in: ids('AdditionalWorkingDay') } };
      otWhere = { id: { in: ids('AttendanceLog') } };
    }

    const employee = {
      select: { id: true, fullName: true, employeeCode: true, currentBranch: { select: { name: true } } },
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
    const requesterIds = [...new Set(logs.map((l) => l.overtimeRequestedById).filter(Boolean))] as string[];
    const requesters = requesterIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: requesterIds } }, select: { id: true, email: true } })
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
      ((status === ExtraTimeStatus.PENDING && hrOps) || (status === ExtraTimeStatus.ESCALATED && chairman));
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
          { at: d.createdAt.toISOString(), by: d.addedBy.email, text: 'Extra day entered', note: d.note },
          ...decisions(d.id),
          ...waiting(d.status),
        ],
      })),
      ...logs.map((l) => {
        const status = l.overtimeStatus!;
        const by = l.overtimeRequestedById ? (emailOf.get(l.overtimeRequestedById) ?? null) : null;
        const entered = audits.find((a) => a.entityId === l.id && a.userId === l.overtimeRequestedById);
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
    ].sort((a, b) => b.date.localeCompare(a.date));

    return { tab, items };
  }

  /** Badge on the sidebar: how many items wait for this login. */
  async todoCount(actor: Actor) {
    const { items } = await this.list(actor, 'todo');
    return { todo: items.length };
  }
}
