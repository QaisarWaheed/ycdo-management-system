import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExtraTimeStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAnyRole } from '../../common/user-roles.util';
import { PayrollService } from '../payroll/payroll.service';
import { assertEmployeeEligibleForRelieverAttendance } from '../attendance/attendance-eligibility.util';
import { CreateAdditionalWorkingDayDto } from './additional-working-days.dto';

export const RELIEVER_AWD_NOTE = 'Reliever duty';

@Injectable()
export class AdditionalWorkingDaysService {
  constructor(
    private prisma: PrismaService,
    private payrollService: PayrollService,
  ) {}

  async create(dto: CreateAdditionalWorkingDayDto, addedById: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with id ${dto.employeeId} not found`);
    }
    assertEmployeeEligibleForRelieverAttendance(employee.status);

    const date = this.toDateOnly(dto.date);

    try {
      // Point 20: HR-entered days start PENDING and are not paid until
      // approved, so salary is not recomputed here.
      return await this.prisma.additionalWorkingDay.create({
        data: {
          employeeId: dto.employeeId,
          date,
          note: dto.note?.trim() || null,
          addedById,
        },
        include: {
          addedBy: { select: { id: true, email: true } },
        },
      });
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new BadRequestException(
          'An additional working day already exists for this date',
        );
      }
      throw err;
    }
  }

  findByEmployee(employeeId: string) {
    return this.prisma.additionalWorkingDay.findMany({
      where: { employeeId },
      orderBy: { date: 'desc' },
      include: {
        addedBy: { select: { id: true, email: true } },
      },
    });
  }

  /**
   * Profile + payroll: completed reliever duty is an extra duty day (already
   * approved). Pay is the Reliever allowance at one full duty day per session.
   */
  async upsertFromRelieverSession(params: {
    relieverSessionId: string;
    employeeId: string;
    date: Date;
    addedById: string;
  }) {
    const date = this.normalizeDateOnly(params.date);

    const existing = await this.prisma.additionalWorkingDay.findUnique({
      where: { relieverSessionId: params.relieverSessionId },
    });
    if (existing) {
      return existing;
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: params.employeeId },
      select: { status: true },
    });
    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${params.employeeId} not found`,
      );
    }
    assertEmployeeEligibleForRelieverAttendance(employee.status);

    try {
      return await this.prisma.additionalWorkingDay.create({
        data: {
          employeeId: params.employeeId,
          date,
          note: RELIEVER_AWD_NOTE,
          addedById: params.addedById,
          relieverSessionId: params.relieverSessionId,
          // System entry from a completed reliever session: no approval step.
          status: ExtraTimeStatus.APPROVED,
        },
      });
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        // Manual AWD already exists for this employee+date — reliever pay is unaffected.
        return null;
      }
      throw err;
    }
  }

  async delete(id: string) {
    const row = await this.prisma.additionalWorkingDay.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException(`Additional working day ${id} not found`);
    }
    if (row.relieverSessionId) {
      throw new BadRequestException(
        'Reliever duty days are managed from attendance and cannot be deleted here',
      );
    }
    await this.prisma.additionalWorkingDay.delete({ where: { id } });
    // Only an approved day was in salary; others never affected pay.
    if (row.status === ExtraTimeStatus.APPROVED) {
      await this.payrollService.recomputePendingPayrollForAttendanceDate(
        row.employeeId,
        row.date,
      );
    }
    return { message: 'Additional working day deleted' };
  }

  /** Point 20: HR-entered extra days and overtime awaiting HR Operations or Chairman. */
  async findPendingExtraTime() {
    const open = { in: [ExtraTimeStatus.PENDING, ExtraTimeStatus.ESCALATED] };
    const employee = {
      select: {
        fullName: true,
        employeeCode: true,
        currentBranch: { select: { name: true } },
      },
    };
    const [days, logs] = await Promise.all([
      this.prisma.additionalWorkingDay.findMany({
        where: { status: open },
        orderBy: { date: 'asc' },
        include: { employee, addedBy: { select: { id: true, email: true } } },
      }),
      this.prisma.attendanceLog.findMany({
        where: { overtimeStatus: open },
        orderBy: { date: 'asc' },
        include: { employee },
      }),
    ]);
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
    const who = (e: (typeof days)[number]['employee']) => ({
      employeeName: e.fullName,
      employeeCode: e.employeeCode,
      branch: e.currentBranch?.name ?? null,
    });
    return [
      ...days.map((d) => ({
        kind: 'day' as const,
        id: d.id,
        ...who(d.employee),
        date: d.date,
        minutes: null,
        note: d.note,
        status: d.status,
        reviewNote: d.reviewNote,
        requestedById: d.addedById,
        requestedBy: d.addedBy.email,
      })),
      ...logs.map((l) => ({
        kind: 'overtime' as const,
        id: l.id,
        ...who(l.employee),
        date: l.date,
        minutes: l.overtimeMinutes,
        note: l.note,
        status: l.overtimeStatus!,
        reviewNote: l.overtimeReviewNote,
        requestedById: l.overtimeRequestedById,
        requestedBy: l.overtimeRequestedById
          ? (emailOf.get(l.overtimeRequestedById) ?? null)
          : null,
      })),
    ];
  }

  /**
   * Point 20 workflow. PENDING: HR Operations / Super Admin approve, or reject
   * (goes to Chairman as ESCALATED). ESCALATED: Chairman / Super Admin approve
   * or reject (final). Whoever entered the item can never review it.
   */
  async reviewExtraTime(
    kind: 'day' | 'overtime',
    id: string,
    approve: boolean,
    user: { id: string; roles: UserRole[] },
    note?: string,
  ) {
    const item =
      kind === 'day'
        ? await this.prisma.additionalWorkingDay
            .findUnique({ where: { id } })
            .then(
              (d) =>
                d && {
                  employeeId: d.employeeId,
                  date: d.date,
                  status: d.status,
                  enteredBy: d.addedById,
                },
            )
        : await this.prisma.attendanceLog
            .findUnique({ where: { id } })
            .then(
              (l) =>
                l && {
                  employeeId: l.employeeId,
                  date: l.date,
                  status: l.overtimeStatus,
                  enteredBy: l.overtimeRequestedById,
                },
            );
    if (!item) throw new NotFoundException(`Extra time ${kind} ${id} not found`);
    if (
      item.status !== ExtraTimeStatus.PENDING &&
      item.status !== ExtraTimeStatus.ESCALATED
    ) {
      throw new BadRequestException('This entry is not awaiting approval');
    }
    if (item.enteredBy === user.id) {
      throw new ForbiddenException('You cannot approve or reject your own entry');
    }
    const escalated = item.status === ExtraTimeStatus.ESCALATED;
    const reviewers = escalated
      ? [UserRole.CHAIRMAN, UserRole.SUPER_ADMIN]
      : [UserRole.HR_OPERATIONS_MANAGER, UserRole.SUPER_ADMIN];
    if (!hasAnyRole(user.roles, reviewers)) {
      throw new ForbiddenException(
        escalated
          ? 'Only the Chairman can decide an escalated entry'
          : 'Only HR Operations can approve or reject this entry',
      );
    }

    const status = approve
      ? ExtraTimeStatus.APPROVED
      : escalated
        ? ExtraTimeStatus.REJECTED
        : ExtraTimeStatus.ESCALATED;
    const now = new Date();
    const reviewNote = note?.trim() || null;
    if (kind === 'day') {
      await this.prisma.additionalWorkingDay.update({
        where: { id },
        data: {
          status,
          reviewedById: user.id,
          reviewedAt: now,
          reviewNote,
          ...(status === ExtraTimeStatus.ESCALATED ? { escalatedAt: now } : {}),
        },
      });
    } else {
      // Rejected minutes stay for history but are never paid (status REJECTED).
      await this.prisma.attendanceLog.update({
        where: { id },
        data: {
          overtimeStatus: status,
          overtimeReviewNote: reviewNote,
          overtimePending: status === ExtraTimeStatus.ESCALATED,
          ...(status === ExtraTimeStatus.APPROVED
            ? { overtimeApprovedBy: user.id, overtimeApprovedAt: now }
            : {}),
          ...(status === ExtraTimeStatus.ESCALATED
            ? { overtimeEscalatedAt: now }
            : {}),
        },
      });
    }
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: `EXTRA_TIME_${status}`,
        entity: kind === 'day' ? 'AdditionalWorkingDay' : 'AttendanceLog',
        entityId: id,
        changes: { kind, from: item.status, to: status, note: reviewNote },
      },
    });
    await this.payrollService.recomputePendingPayrollForAttendanceDate(
      item.employeeId,
      item.date,
    );
    return { id, kind, status };
  }

  private toDateOnly(isoDate: string): Date {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Invalid date');
    }
    return this.normalizeDateOnly(d);
  }

  private normalizeDateOnly(d: Date): Date {
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }
}
