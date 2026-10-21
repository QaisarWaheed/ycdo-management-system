import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, PaySuggestionKind, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normDesignation, teamEmployeeWhere } from './team.util';

type Pair = { departmentId: string; designation: string };

@Injectable()
export class TeamService {
  constructor(private prisma: PrismaService) {}

  /**
   * IT screen: every department + designation that has active staff, who holds
   * each one, and the Team In-charge logins to give them to.
   */
  async options() {
    const [groups, departments, assignments, logins] = await Promise.all([
      this.prisma.employee.groupBy({
        by: ['currentDepartmentId', 'currentDesignation'],
        where: {
          status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] },
          currentDepartmentId: { not: null },
          currentDesignation: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.department.findMany({ where: { isDeleted: false }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.teamAssignment.findMany({ include: { user: { select: { id: true, email: true } } } }),
      this.prisma.user.findMany({
        where: {
          isActive: true,
          OR: [{ role: UserRole.TEAM_INCHARGE }, { additionalRoles: { some: { role: UserRole.TEAM_INCHARGE } } }],
        },
        select: { id: true, email: true, employee: { select: { fullName: true } } },
        orderBy: { email: 'asc' },
      }),
    ]);
    // Same designation written differently ("Staff Nurse", "STAFF NURSE ") is one pair.
    const counts = new Map<string, Pair & { employees: number }>();
    for (const g of groups) {
      const designation = normDesignation(g.currentDesignation!);
      if (!designation) continue;
      const k = `${g.currentDepartmentId}|${designation}`;
      const row = counts.get(k) ?? { departmentId: g.currentDepartmentId!, designation, employees: 0 };
      row.employees += g._count._all;
      counts.set(k, row);
    }
    const holder = new Map(assignments.map((a) => [`${a.departmentId}|${a.designation}`, a]));
    // A pair assigned earlier whose staff left still shows, so IT can remove it.
    for (const a of assignments) {
      const k = `${a.departmentId}|${a.designation}`;
      if (!counts.has(k)) counts.set(k, { departmentId: a.departmentId, designation: a.designation, employees: 0 });
    }
    return {
      departments,
      logins: logins.map((u) => ({ id: u.id, email: u.email, name: u.employee?.fullName ?? null })),
      pairs: [...counts.values()]
        .map((p) => {
          const a = holder.get(`${p.departmentId}|${p.designation}`);
          return { ...p, assignment: a ? { id: a.id, userId: a.userId, email: a.user.email } : null };
        })
        .sort((x, y) => x.designation.localeCompare(y.designation)),
    };
  }

  /** Give department + designation pairs to a Team In-charge login; a pair belongs to one login only. */
  async assign(actorId: string, userId: string, pairs: Pair[]) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, additionalRoles: { select: { role: true } } },
    });
    if (!user) throw new NotFoundException('Login not found');
    const roles = [user.role, ...user.additionalRoles.map((r) => r.role)];
    if (!roles.includes(UserRole.TEAM_INCHARGE)) {
      throw new BadRequestException('Give this login the Team In-charge role first');
    }
    const wanted = pairs.map((p) => ({ departmentId: p.departmentId, designation: normDesignation(p.designation) }));
    const taken = await this.prisma.teamAssignment.findMany({
      where: { OR: wanted.map((p) => ({ departmentId: p.departmentId, designation: p.designation })) },
      include: { user: { select: { email: true } }, department: { select: { name: true } } },
    });
    const others = taken.filter((t) => t.userId !== userId);
    if (others.length) {
      throw new ConflictException(
        `Already assigned: ${others.map((t) => `${t.department.name} / ${t.designation} → ${t.user.email}`).join(', ')}`,
      );
    }
    const mine = new Set(taken.map((t) => `${t.departmentId}|${t.designation}`));
    const fresh = wanted.filter((p) => !mine.has(`${p.departmentId}|${p.designation}`));
    await this.prisma.teamAssignment.createMany({
      data: fresh.map((p) => ({ ...p, userId, createdById: actorId })),
      skipDuplicates: true,
    });
    await this.prisma.auditLog.create({
      data: { userId: actorId, action: 'TEAM_ASSIGNED', entity: 'User', entityId: userId, changes: { pairs: fresh } },
    });
    return { assigned: fresh.length };
  }

  async unassign(actorId: string, id: string) {
    const row = await this.prisma.teamAssignment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Assignment not found');
    await this.prisma.teamAssignment.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'TEAM_UNASSIGNED',
        entity: 'User',
        entityId: row.userId,
        changes: { departmentId: row.departmentId, designation: row.designation },
      },
    });
    return { removed: true };
  }

  /** My Team page: the in-charge's employees with this month's rating, incentive suggestions and extra days. */
  async my(userId: string, month: number, year: number) {
    const where = await teamEmployeeWhere(this.prisma, userId);
    const [employees, incentiveTypes, pairs] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          photoUrl: true,
          currentDesignation: true,
          currentBranch: { select: { name: true } },
          currentDepartment: { select: { name: true } },
        },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.incentiveType.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.teamAssignment.findMany({
        where: { userId },
        select: { designation: true, department: { select: { name: true } } },
      }),
    ]);
    const ids = employees.map((e) => e.id);
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));
    const [progress, suggestions, days] = await Promise.all([
      this.prisma.teamProgress.findMany({ where: { employeeId: { in: ids }, month, year } }),
      this.prisma.incentiveSuggestion.findMany({
        where: { employeeId: { in: ids }, month, year, kind: PaySuggestionKind.INCENTIVE },
        select: { employeeId: true, typeId: true, suggestedAmount: true, status: true, approvedAmount: true },
      }),
      this.prisma.additionalWorkingDay.findMany({
        where: { employeeId: { in: ids }, date: { gte: from, lt: to } },
        select: { id: true, employeeId: true, date: true, status: true, note: true },
        orderBy: { date: 'asc' },
      }),
    ]);
    const typeName = new Map(incentiveTypes.map((t) => [t.id, t.name]));
    return {
      month,
      year,
      assignments: pairs.map((p) => ({ department: p.department.name, designation: p.designation })),
      incentiveTypes,
      employees: employees.map((e) => {
        const p = progress.find((x) => x.employeeId === e.id);
        return {
          id: e.id,
          fullName: e.fullName,
          employeeCode: e.employeeCode,
          photoUrl: e.photoUrl,
          designation: e.currentDesignation,
          branch: e.currentBranch?.name ?? null,
          department: e.currentDepartment?.name ?? null,
          progress: p ? { rating: p.rating, remarks: p.remarks } : null,
          suggestions: suggestions
            .filter((s) => s.employeeId === e.id)
            .map((s) => ({
              type: typeName.get(s.typeId) ?? 'Incentive',
              amount: Number(s.suggestedAmount),
              status: s.status,
              approvedAmount: s.approvedAmount == null ? null : Number(s.approvedAmount),
            })),
          extraDays: days
            .filter((d) => d.employeeId === e.id)
            .map((d) => ({ id: d.id, date: d.date.toISOString().slice(0, 10), status: d.status, note: d.note })),
        };
      }),
    };
  }

  async assertInTeam(userId: string, employeeId: string) {
    const where = await teamEmployeeWhere(this.prisma, userId);
    const n = await this.prisma.employee.count({ where: { AND: [where, { id: employeeId }] } });
    if (!n) throw new ForbiddenException('This employee is not in your team');
  }

  async saveProgress(userId: string, dto: { employeeId: string; month: number; year: number; rating: number; remarks?: string }) {
    await this.assertInTeam(userId, dto.employeeId);
    const data = { rating: dto.rating, remarks: dto.remarks?.trim() || null, authorId: userId };
    return this.prisma.teamProgress.upsert({
      where: { employeeId_month_year: { employeeId: dto.employeeId, month: dto.month, year: dto.year } },
      update: data,
      create: { ...data, employeeId: dto.employeeId, month: dto.month, year: dto.year },
    });
  }
}
