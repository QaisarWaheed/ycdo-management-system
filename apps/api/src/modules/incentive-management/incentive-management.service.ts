import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  DeductionType,
  EmployeeStatus,
  LetterType,
  PaySuggestionKind,
  PaySuggestionStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAnyRole } from '../../common/user-roles.util';
import { IncentivesService } from '../incentives/incentives.service';
import { AllowancesService } from '../allowances/allowances.service';
import { isActiveInMonth } from '../allowances/package-allowances.util';
import { buildSuspensionWatchlist } from '../attendance/suspension-watchlist';

export const SUGGEST_ROLES: UserRole[] = [
  UserRole.DEPARTMENT_HEAD,
  UserRole.PAYROLL_OFFICER,
  UserRole.SUPER_ADMIN,
];
export const DECIDE_ROLES: UserRole[] = [
  UserRole.CHAIRMAN,
  UserRole.PRESIDENT,
  UserRole.FOUNDER,
  UserRole.SUPER_ADMIN,
];

type Actor = { id: string; role: UserRole; roles: UserRole[] };
const ISSUE_LETTERS: LetterType[] = [
  LetterType.WARNING,
  LetterType.SHOW_CAUSE,
  LetterType.EXPLANATION,
  LetterType.EXPLANATION_FINE,
  LetterType.FINE,
  LetterType.DISCIPLINARY,
  LetterType.NEAR_SUSPENSION_WARNING,
  LetterType.SUSPENSION_ELIGIBILITY,
];
const prev = (year: number, month: number) =>
  month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
const monthStr = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
const key = (employeeId: string, kind: string, typeId: string) => `${employeeId}|${kind}|${typeId}`;

/**
 * Phase 2 Req 7 & 8: per employee and per incentive / allowance type the
 * previous month's amount, the suggestion (Department Head / Accounts) and
 * the current amount. Executives approve, amend, reject or type the current
 * amount, one by one or in bulk; approved amounts go through the normal
 * incentive / allowance services (payroll, slips, audit as usual).
 */
@Injectable()
export class IncentiveManagementService {
  constructor(
    private prisma: PrismaService,
    private incentives: IncentivesService,
    private allowances: AllowancesService,
  ) {}

  /** Department Heads see only their own department. */
  private async scope(actor: Actor, q: { branchId?: string; departmentId?: string }) {
    const where: Prisma.EmployeeWhereInput = {
      status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] },
      ...(q.branchId ? { currentBranchId: q.branchId } : {}),
      ...(q.departmentId ? { currentDepartmentId: q.departmentId } : {}),
    };
    const onlyHead =
      actor.roles.includes(UserRole.DEPARTMENT_HEAD) &&
      !hasAnyRole(actor.roles, [...DECIDE_ROLES, UserRole.PAYROLL_OFFICER]);
    if (onlyHead) {
      const me = await this.prisma.user.findUnique({
        where: { id: actor.id },
        select: { employee: { select: { currentDepartmentId: true } } },
      });
      const dept = me?.employee?.currentDepartmentId;
      if (!dept) throw new ForbiddenException('Your login has no department');
      where.currentDepartmentId = dept;
    }
    return where;
  }

  async board(actor: Actor, q: { month: number; year: number; branchId?: string; departmentId?: string }) {
    const employeeWhere = await this.scope(actor, q);
    const p = prev(q.year, q.month);
    const [employees, incentiveTypes, allowanceTypes] = await Promise.all([
      this.prisma.employee.findMany({
        where: employeeWhere,
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          currentBranch: { select: { name: true } },
          currentDepartment: { select: { name: true } },
        },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.incentiveType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.payAllowanceType.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    ]);
    const ids = employees.map((e) => e.id);
    const [incentiveRows, allowanceRows, suggestions] = await Promise.all([
      this.prisma.incentive.findMany({
        where: {
          employeeId: { in: ids },
          typeId: { not: null },
          OR: [
            { month: q.month, year: q.year },
            { month: p.month, year: p.year },
          ],
        },
        select: { employeeId: true, typeId: true, month: true, year: true, amount: true },
      }),
      this.prisma.employeeAllowance.findMany({
        where: { employeeId: { in: ids } },
        select: { employeeId: true, typeId: true, amount: true, startMonth: true, endMonth: true },
      }),
      this.prisma.incentiveSuggestion.findMany({
        where: { employeeId: { in: ids }, month: q.month, year: q.year },
      }),
    ]);

    type Row = {
      employeeId: string;
      kind: PaySuggestionKind;
      typeId: string;
      previous: number;
      current: number;
      suggestion: null | {
        id: string;
        amount: number;
        status: PaySuggestionStatus;
        note: string | null;
        approvedAmount: number | null;
      };
    };
    const rows = new Map<string, Row>();
    const row = (employeeId: string, kind: PaySuggestionKind, typeId: string) => {
      const k = key(employeeId, kind, typeId);
      let r = rows.get(k);
      if (!r) {
        r = { employeeId, kind, typeId, previous: 0, current: 0, suggestion: null };
        rows.set(k, r);
      }
      return r;
    };
    for (const i of incentiveRows) {
      const r = row(i.employeeId, PaySuggestionKind.INCENTIVE, i.typeId!);
      if (i.month === q.month && i.year === q.year) r.current += Number(i.amount);
      else r.previous += Number(i.amount);
    }
    for (const a of allowanceRows) {
      const inPrev = isActiveInMonth(a, p.year, p.month);
      const inCur = isActiveInMonth(a, q.year, q.month);
      if (!inPrev && !inCur) continue;
      const r = row(a.employeeId, PaySuggestionKind.ALLOWANCE, a.typeId);
      if (inPrev) r.previous += Number(a.amount);
      if (inCur) r.current += Number(a.amount);
    }
    for (const s of suggestions) {
      row(s.employeeId, s.kind, s.typeId).suggestion = {
        id: s.id,
        amount: Number(s.suggestedAmount),
        status: s.status,
        note: s.note,
        approvedAmount: s.approvedAmount == null ? null : Number(s.approvedAmount),
      };
    }

    const issues = await this.performanceIssues(ids, q.year, q.month);
    const typeName = new Map<string, string>([
      ...incentiveTypes.map((t) => [`INCENTIVE|${t.id}`, t.name] as [string, string]),
      ...allowanceTypes.map((t) => [`ALLOWANCE|${t.id}`, t.name] as [string, string]),
    ]);
    const empById = new Map(employees.map((e) => [e.id, e]));
    return {
      month: q.month,
      year: q.year,
      incentiveTypes: incentiveTypes.map((t) => ({ id: t.id, name: t.name })),
      allowanceTypes: allowanceTypes.map((t) => ({ id: t.id, name: t.name })),
      employees: employees.map((e) => ({
        id: e.id,
        fullName: e.fullName,
        employeeCode: e.employeeCode,
        branch: e.currentBranch?.name ?? null,
        department: e.currentDepartment?.name ?? null,
        issues: issues.get(e.id) ?? [],
      })),
      rows: [...rows.values()]
        .filter((r) => empById.has(r.employeeId))
        .map((r) => ({ ...r, typeName: typeName.get(`${r.kind}|${r.typeId}`) ?? 'Removed type' })),
    };
  }

  /** Fine, warning-type letter or watchlist this month (decrease is added on the screen). */
  private async performanceIssues(ids: string[], year: number, month: number) {
    const out = new Map<string, string[]>();
    if (!ids.length) return out;
    const add = (id: string, issue: string) => {
      const list = out.get(id) ?? [];
      if (!list.includes(issue)) list.push(issue);
      out.set(id, list);
    };
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const [fines, letters, watch] = await Promise.all([
      this.prisma.payrollDeduction.findMany({
        where: {
          reason: DeductionType.DISCIPLINARY_FINE,
          payrollEntry: { month, year, stipendRecord: { employeeId: { in: ids } } },
        },
        select: { payrollEntry: { select: { stipendRecord: { select: { employeeId: true } } } } },
      }),
      this.prisma.letter.findMany({
        where: {
          employeeId: { in: ids },
          letterType: { in: ISSUE_LETTERS },
          generatedAt: { gte: start, lt: end },
        },
        select: { employeeId: true },
      }),
      buildSuspensionWatchlist(this.prisma as never, year, month).catch(() => null),
    ]);
    for (const f of fines) add(f.payrollEntry.stipendRecord.employeeId, 'Fine this month');
    for (const l of letters) add(l.employeeId, 'Warning / letter');
    if (watch) {
      for (const w of [...watch.near, ...watch.due]) {
        if (ids.includes(w.employeeId)) add(w.employeeId, 'Late / absent watchlist');
      }
    }
    return out;
  }

  async suggest(
    actor: Actor,
    dto: { employeeId: string; kind: PaySuggestionKind; typeId: string; month: number; year: number; amount: number; note?: string },
  ) {
    if (!hasAnyRole(actor.roles, SUGGEST_ROLES)) throw new ForbiddenException('You cannot suggest');
    const scope = await this.scope(actor, {});
    const allowed = await this.prisma.employee.count({ where: { AND: [scope, { id: dto.employeeId }] } });
    if (!allowed) throw new ForbiddenException('This employee is not in your department');
    const existing = await this.prisma.incentiveSuggestion.findUnique({
      where: {
        employeeId_kind_typeId_month_year: {
          employeeId: dto.employeeId,
          kind: dto.kind,
          typeId: dto.typeId,
          month: dto.month,
          year: dto.year,
        },
      },
    });
    if (existing && existing.status !== PaySuggestionStatus.PENDING && existing.status !== PaySuggestionStatus.REJECTED) {
      throw new BadRequestException('Already approved for this month');
    }
    const data = {
      suggestedAmount: dto.amount,
      note: dto.note?.trim() || null,
      suggestedById: actor.id,
      status: PaySuggestionStatus.PENDING,
      approvedAmount: null,
      decidedById: null,
      decidedAt: null,
      decisionNote: null,
    };
    const saved = existing
      ? await this.prisma.incentiveSuggestion.update({ where: { id: existing.id }, data })
      : await this.prisma.incentiveSuggestion.create({
          data: { ...data, employeeId: dto.employeeId, kind: dto.kind, typeId: dto.typeId, month: dto.month, year: dto.year },
        });
    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: 'PAY_SUGGESTED',
        entity: 'IncentiveSuggestion',
        entityId: saved.id,
        changes: { employeeId: dto.employeeId, kind: dto.kind, amount: dto.amount, month: `${dto.month}/${dto.year}` },
      },
    });
    return saved;
  }

  /**
   * Executive approval: each item sets the month's amount for that employee
   * and type (suggested, amended or typed in). Items run one by one so one
   * failure (e.g. month already paid) does not block the rest.
   */
  async apply(
    actor: Actor,
    dto: {
      month: number;
      year: number;
      items: Array<{ employeeId: string; kind: PaySuggestionKind; typeId: string; amount: number; note?: string }>;
    },
  ) {
    if (!hasAnyRole(actor.roles, DECIDE_ROLES)) throw new ForbiddenException('Only executives can approve');
    const applied: string[] = [];
    const failed: Array<{ employeeId: string; typeId: string; reason: string }> = [];
    for (const item of dto.items) {
      try {
        if (item.kind === PaySuggestionKind.INCENTIVE) await this.setIncentive(actor, dto, item);
        else await this.setAllowance(actor, dto, item);
        const s = await this.prisma.incentiveSuggestion.findUnique({
          where: {
            employeeId_kind_typeId_month_year: {
              employeeId: item.employeeId,
              kind: item.kind,
              typeId: item.typeId,
              month: dto.month,
              year: dto.year,
            },
          },
        });
        if (s) {
          await this.prisma.incentiveSuggestion.update({
            where: { id: s.id },
            data: {
              status:
                Number(s.suggestedAmount) === item.amount
                  ? PaySuggestionStatus.APPROVED
                  : PaySuggestionStatus.AMENDED,
              approvedAmount: item.amount,
              decidedById: actor.id,
              decidedAt: new Date(),
              decisionNote: item.note?.trim() || null,
            },
          });
        }
        applied.push(`${item.employeeId}|${item.typeId}`);
      } catch (err) {
        failed.push({
          employeeId: item.employeeId,
          typeId: item.typeId,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { applied: applied.length, failed };
  }

  async reject(actor: Actor, dto: { suggestionIds: string[]; note?: string }) {
    if (!hasAnyRole(actor.roles, DECIDE_ROLES)) throw new ForbiddenException('Only executives can reject');
    const r = await this.prisma.incentiveSuggestion.updateMany({
      where: { id: { in: dto.suggestionIds }, status: PaySuggestionStatus.PENDING },
      data: {
        status: PaySuggestionStatus.REJECTED,
        decidedById: actor.id,
        decidedAt: new Date(),
        decisionNote: dto.note?.trim() || null,
      },
    });
    return { rejected: r.count };
  }

  /** The month's incentive of this type becomes `amount` (created, or the latest row changed). */
  private async setIncentive(
    actor: Actor,
    m: { month: number; year: number },
    item: { employeeId: string; typeId: string; amount: number; note?: string },
  ) {
    const rows = await this.prisma.incentive.findMany({
      where: { employeeId: item.employeeId, typeId: item.typeId, month: m.month, year: m.year },
      orderBy: { createdAt: 'desc' },
    });
    if (!rows.length) {
      if (item.amount <= 0) return;
      await this.incentives.create(
        {
          employeeId: item.employeeId,
          typeId: item.typeId,
          amount: item.amount,
          month: m.month,
          year: m.year,
          reason: item.note?.trim() || undefined,
        } as never,
        actor.id,
        actor.role,
      );
      return;
    }
    const others = rows.slice(1).reduce((s, r) => s + Number(r.amount), 0);
    const latest = item.amount - others;
    if (latest <= 0) {
      if (item.amount === 0 && rows.length === 1) {
        await this.incentives.delete(rows[0].id, actor.id);
        return;
      }
      throw new BadRequestException('Lower than the other incentives of this type this month; edit them on the Incentives page');
    }
    await this.incentives.update(
      rows[0].id,
      { amount: latest, typeId: item.typeId, month: m.month, year: m.year } as never,
      actor.id,
    );
  }

  /** The allowance of this type pays `amount` from this month (keeping its end month). */
  private async setAllowance(
    actor: Actor,
    m: { month: number; year: number },
    item: { employeeId: string; typeId: string; amount: number; note?: string },
  ) {
    const rows = await this.prisma.employeeAllowance.findMany({
      where: { employeeId: item.employeeId, typeId: item.typeId },
    });
    const current = rows.find((r) => isActiveInMonth(r, m.year, m.month));
    if (item.amount <= 0) {
      if (current) {
        const p = prev(m.year, m.month);
        await this.allowances.end(current.id, monthStr(p.year, p.month), actor);
      }
      return;
    }
    await this.allowances.assign(
      {
        employeeId: item.employeeId,
        typeId: item.typeId,
        amount: item.amount,
        startMonth: monthStr(m.year, m.month),
        endMonth: current?.endMonth ? current.endMonth.toISOString().slice(0, 7) : undefined,
        endDay: current?.endDay ?? undefined,
        note: item.note?.trim() || current?.note || 'Set by executive (incentive management)',
      },
      actor,
    );
  }
}
