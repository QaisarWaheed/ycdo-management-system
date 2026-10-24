import { Body, Controller, Injectable, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  AttendanceLogType,
  AttendanceSource,
  DisciplineCategory,
  LetterStatus,
  UserRole,
} from '@prisma/client';
import { MISSING_CHECKOUT_AUTO_NOTE } from '../attendance/missing-checkout-policy';

/** Same as attendance.service's private helper: drop the scheduler's auto-checkout marker. */
const stripMissingCheckoutMarker = (note: string | null | undefined) =>
  (note ?? '')
    .split(' | ')
    .filter((part) => part.trim() !== MISSING_CHECKOUT_AUTO_NOTE)
    .join(' | ');
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, StrictRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PayrollService } from '../payroll/payroll.service';
import { LettersService } from './letters.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Which automatic missing-checkout letters to reverse (all given fields must match). */
export class BulkReverseRule {
  /** Employee's current branch, exact name. */
  @IsOptional() @IsString() branch?: string;
  /** Incident date range, inclusive (YYYY-MM-DD). */
  @IsOptional() @Matches(DAY) from?: string;
  @IsOptional() @Matches(DAY) to?: string;
  /** Only these incident dates. */
  @IsOptional() @IsArray() @Matches(DAY, { each: true }) dates?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) employeeCodes?: string[];
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeEmployeeCodes?: string[];
}

export class BulkReverseDto {
  @IsString() @MinLength(3) reason: string;
  /** true = only list what would be reversed. */
  @IsBoolean() dryRun: boolean;
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkReverseRule)
  rules: BulkReverseRule[];
  /** Max letters reversed per call; call again until remaining is 0. */
  @IsOptional() @IsInt() @Min(1) @Max(300) limit?: number;
  /** 'attendance' = clear the auto missing-checkout marker on attendance rows instead of reversing letters. */
  @IsOptional() @IsIn(['letters', 'attendance']) target?:
    | 'letters'
    | 'attendance';
}

export type Candidate = {
  id: string;
  letterNo: string | null;
  letterType: string;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string;
  branch: string | null;
  incidentDate: string | null;
};

const code = (c: string) =>
  c
    .trim()
    .toUpperCase()
    .replace(/^(\d+)$/, 'YCDO-2026-$1');

export function matchesRule(c: Candidate, r: BulkReverseRule): boolean {
  if (!c.incidentDate) return false;
  const d = c.incidentDate;
  const emp = c.employeeCode ? code(c.employeeCode) : '';
  if (r.branch && r.branch !== c.branch) return false;
  if (r.from && d < r.from) return false;
  if (r.to && d > r.to) return false;
  if (r.dates?.length && !r.dates.includes(d)) return false;
  if (r.employeeCodes?.length && !r.employeeCodes.map(code).includes(emp))
    return false;
  if (r.excludeEmployeeCodes?.map(code).includes(emp)) return false;
  return true;
}

/**
 * Reverse many automatic MISSING_CHECKOUT letters at once (device-outage
 * relief). Each letter goes through the normal reverseLetter (discipline event
 * removed, fine unwound, audited); then each touched employee-month payroll is
 * recomputed so the 1-day-per-3-incidents cut follows.
 */
@Injectable()
export class BulkReverseService {
  constructor(
    private prisma: PrismaService,
    private letters: LettersService,
    private payroll: PayrollService,
  ) {}

  async candidates(rules: BulkReverseRule[]): Promise<Candidate[]> {
    const rows = await this.prisma.letter.findMany({
      where: {
        status: { notIn: [LetterStatus.REVERSED, LetterStatus.DRAFT] },
        createdById: null,
        variables: { path: ['disciplineCategory'], equals: 'MISSING_CHECKOUT' },
      },
      select: {
        id: true,
        letterNo: true,
        letterType: true,
        variables: true,
        employeeId: true,
        employee: {
          select: {
            employeeCode: true,
            fullName: true,
            currentBranch: { select: { name: true } },
          },
        },
      },
    });
    // ponytail: branch = employee's CURRENT branch; fine while transfers between these branches are rare.
    return rows
      .map((l) => {
        const v = (l.variables ?? {}) as Record<string, unknown>;
        return {
          id: l.id,
          letterNo: l.letterNo,
          letterType: l.letterType,
          employeeId: l.employeeId,
          employeeCode: l.employee.employeeCode,
          employeeName: l.employee.fullName.replace(/\s+/g, ' ').trim(),
          branch: l.employee.currentBranch?.name ?? null,
          incidentDate:
            typeof v.incidentDate === 'string'
              ? v.incidentDate.slice(0, 10)
              : null,
        };
      })
      .filter((c) => rules.some((r) => matchesRule(c, r)))
      .sort((a, b) =>
        `${a.branch}${a.employeeName}${a.incidentDate}`.localeCompare(
          `${b.branch}${b.employeeName}${b.incidentDate}`,
        ),
      );
  }

  /** Attendance rows still carrying the scheduler's auto missing-checkout marker. */
  async attendanceCandidates(rules: BulkReverseRule[]) {
    const rows = await this.prisma.attendanceLog.findMany({
      where: {
        type: AttendanceLogType.REGULAR,
        note: { contains: MISSING_CHECKOUT_AUTO_NOTE },
      },
      select: {
        id: true,
        date: true,
        note: true,
        employeeId: true,
        employee: {
          select: {
            employeeCode: true,
            fullName: true,
            currentBranch: { select: { name: true } },
          },
        },
      },
    });
    return rows
      .map((r) => ({
        id: r.id,
        note: r.note,
        letterNo: null,
        letterType: 'ATTENDANCE',
        employeeId: r.employeeId,
        employeeCode: r.employee.employeeCode,
        employeeName: r.employee.fullName.replace(/\s+/g, ' ').trim(),
        branch: r.employee.currentBranch?.name ?? null,
        incidentDate: r.date.toISOString().slice(0, 10),
      }))
      .filter((c) => rules.some((r) => matchesRule(c, r)));
  }

  /** Relief on the attendance itself so a later re-run cannot re-create the missed checkout. */
  private async runAttendance(dto: BulkReverseDto, userId: string) {
    const all = await this.attendanceCandidates(dto.rules);
    const byBranch: Record<string, number> = {};
    for (const c of all)
      byBranch[c.branch ?? '-'] = (byBranch[c.branch ?? '-'] ?? 0) + 1;
    if (dto.dryRun)
      return { dryRun: true, total: all.length, byBranch, rows: all };

    const batch = all.slice(0, dto.limit ?? 100);
    const months = new Map<string, { employeeId: string; date: Date }>();
    const failed: Array<{ id: string; error: string }> = [];
    let updated = 0;
    for (const c of batch) {
      const day = new Date(`${c.incidentDate}T00:00:00.000Z`);
      const note = [
        stripMissingCheckoutMarker(c.note),
        `Missing checkout relief: ${dto.reason}`,
      ]
        .filter((p) => p.trim())
        .join(' | ');
      try {
        await this.prisma.$transaction([
          this.prisma.attendanceLog.update({
            where: { id: c.id },
            data: { note, checkOutSource: AttendanceSource.MANUAL },
          }),
          this.prisma.disciplineEvent.deleteMany({
            where: {
              employeeId: c.employeeId,
              category: DisciplineCategory.MISSING_CHECKOUT,
              incidentDate: day,
            },
          }),
          this.prisma.auditLog.create({
            data: {
              userId,
              action: 'ATTENDANCE_UPDATED',
              entity: 'AttendanceLog',
              entityId: c.id,
              changes: {
                previous: { note: c.note },
                updated: { note, checkOutSource: 'MANUAL' },
                reason: dto.reason,
              },
            },
          }),
        ]);
        updated++;
        months.set(`${c.employeeId}|${c.incidentDate.slice(0, 7)}`, {
          employeeId: c.employeeId,
          date: day,
        });
      } catch (e) {
        failed.push({
          id: c.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    for (const m of months.values()) {
      await this.payroll.recomputePendingPayrollForAttendanceDate(
        m.employeeId,
        m.date,
      );
    }
    return {
      dryRun: false,
      updated,
      failed,
      payrollRecomputed: months.size,
      remaining: all.length - updated,
    };
  }

  async run(dto: BulkReverseDto, userId: string) {
    if (dto.target === 'attendance') return this.runAttendance(dto, userId);
    const all = await this.candidates(dto.rules);
    const byBranch: Record<string, Record<string, number>> = {};
    for (const c of all) {
      const b = (byBranch[c.branch ?? '-'] ??= {});
      b[c.letterType] = (b[c.letterType] ?? 0) + 1;
    }
    if (dto.dryRun)
      return { dryRun: true, total: all.length, byBranch, letters: all };

    const batch = all.slice(0, dto.limit ?? 100);
    const done: Array<{ id: string; message: string }> = [];
    const failed: Array<{ id: string; error: string }> = [];
    const months = new Map<string, { employeeId: string; date: Date }>();
    for (const c of batch) {
      try {
        const r = await this.letters.reverseLetter(
          c.id,
          { reason: dto.reason },
          userId,
        );
        done.push({ id: c.id, message: r.message });
        months.set(`${c.employeeId}|${c.incidentDate!.slice(0, 7)}`, {
          employeeId: c.employeeId,
          date: new Date(`${c.incidentDate}T00:00:00.000Z`),
        });
      } catch (e) {
        failed.push({
          id: c.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    for (const m of months.values()) {
      await this.payroll.recomputePendingPayrollForAttendanceDate(
        m.employeeId,
        m.date,
      );
    }
    return {
      dryRun: false,
      reversed: done.length,
      failed,
      payrollRecomputed: months.size,
      remaining: all.length - batch.length + failed.length,
    };
  }
}

@Controller('letters-bulk-reverse')
@UseGuards(JwtAuthGuard, RolesGuard)
@StrictRoles()
export class BulkReverseController {
  constructor(private service: BulkReverseService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  run(@Body() dto: BulkReverseDto, @CurrentUser() user: { id: string }) {
    return this.service.run(dto, user.id);
  }
}
