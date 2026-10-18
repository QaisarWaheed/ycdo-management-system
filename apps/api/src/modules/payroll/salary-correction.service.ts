import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AllowanceType,
  DeductionType,
  PayrollActivity,
  PayrollStatus,
  Prisma,
  SalaryCorrectionStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, StrictRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  ActivityWindowsService,
  actorOf,
} from '../activity-windows/activity-windows';
import { daysInPayrollMonth } from '../../common/stipend.util';
import { resolveDailyDutyHours, roundMoney } from './payroll-hours.util';

type Actor = { id: string; roles: UserRole[] };
export type CorrectionLine = {
  kind: 'OVERTIME' | 'EXTRA_DUTY' | 'ADD' | 'DEDUCT';
  hours?: number;
  days?: number;
  amount?: number;
  note?: string;
};

/** Signed money of HR's lines: overtime hours × hourly rate, days × daily rate, ± amounts. */
export function correctionLineAmounts(
  lines: CorrectionLine[],
  rate: { basic: number; daysInMonth: number; dailyHours: number },
) {
  const daily = rate.basic / rate.daysInMonth;
  const hourly = daily / rate.dailyHours;
  const priced = lines.map((l) => {
    const amount =
      l.kind === 'OVERTIME'
        ? roundMoney((l.hours ?? 0) * hourly)
        : l.kind === 'EXTRA_DUTY'
          ? roundMoney((l.days ?? 0) * daily)
          : roundMoney(Math.abs(l.amount ?? 0));
    return { ...l, amount, signed: l.kind === 'DEDUCT' ? -amount : amount };
  });
  return {
    lines: priced,
    impact: roundMoney(priced.reduce((s, l) => s + l.signed, 0)),
  };
}

/**
 * Req 20.1–20.3: employee correction requests. HR Operations (3rd 12:00 →
 * 5th 12:00, IT can extend) accepts with priced corrections and forwards, or
 * rejects; the Chairman decides one, several or all (no time limit). An
 * approved correction is added to that month's salary (reopened for Finance
 * if it was already verified), or to the next open month if it was paid.
 */
@Injectable()
export class SalaryCorrectionService {
  constructor(
    private prisma: PrismaService,
    private windows: ActivityWindowsService,
  ) {}

  list(q: { status?: SalaryCorrectionStatus; month?: number; year?: number }) {
    return this.prisma.salaryCorrectionRequest.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.month ? { month: q.month } : {}),
        ...(q.year ? { year: q.year } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            currentBranch: { select: { name: true } },
            currentDepartment: { select: { name: true } },
          },
        },
      },
    });
  }

  mine(employeeId: string) {
    return this.prisma.salaryCorrectionRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      take: 24,
    });
  }

  /** Rates for pricing lines on the screen (and on save). */
  async rate(requestId: string) {
    const req = await this.prisma.salaryCorrectionRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) throw new NotFoundException('Request not found');
    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: req.payrollEntryId },
      include: { stipendRecord: { include: { employee: true } } },
    });
    if (!entry) throw new NotFoundException('Salary not found');
    return {
      basic: Number(entry.stipendRecord.basicStipend),
      daysInMonth: daysInPayrollMonth(req.year, req.month),
      dailyHours: resolveDailyDutyHours(entry.stipendRecord.employee),
    };
  }

  async hrDecide(
    id: string,
    dto: { accept: boolean; lines?: CorrectionLine[]; note?: string },
    actor: Actor,
  ) {
    await this.windows.assertOpen(PayrollActivity.HR_SALARY_CORRECTIONS, actor);
    const req = await this.prisma.salaryCorrectionRequest.findUnique({
      where: { id },
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== SalaryCorrectionStatus.SUBMITTED)
      throw new BadRequestException('Already decided');
    let data: Prisma.SalaryCorrectionRequestUpdateInput;
    if (dto.accept) {
      if (!dto.lines?.length)
        throw new BadRequestException(
          'Add the correction (overtime, extra duty or amount)',
        );
      const priced = correctionLineAmounts(dto.lines, await this.rate(id));
      data = {
        status: SalaryCorrectionStatus.FORWARDED,
        hrLines: priced.lines as never,
        impactAmount: priced.impact,
      };
    } else {
      data = { status: SalaryCorrectionStatus.HR_REJECTED };
    }
    const updated = await this.prisma.salaryCorrectionRequest.update({
      where: { id },
      data: {
        ...data,
        hrNote: dto.note?.trim() || null,
        hrById: actor.id,
        hrAt: new Date(),
      },
    });
    await this.notifyEmployee(
      req.employeeId,
      dto.accept
        ? `HR Operations accepted your salary correction (${req.month}/${req.year}) and sent it to the Chairman for approval.`
        : `HR Operations rejected your salary correction (${req.month}/${req.year}).${dto.note ? ` ${dto.note}` : ''}`,
    );
    if (dto.accept) {
      await this.notifyRole(
        UserRole.CHAIRMAN,
        `Salary correction (${req.month}/${req.year}) awaits your approval.`,
      );
    }
    await this.audit(
      actor.id,
      dto.accept
        ? 'SALARY_CORRECTION_FORWARDED'
        : 'SALARY_CORRECTION_HR_REJECTED',
      id,
      {
        employeeId: req.employeeId,
        impact:
          updated.impactAmount == null ? null : Number(updated.impactAmount),
        note: dto.note ?? null,
      },
    );
    return updated;
  }

  /** Chairman: one, several or all (bulk / selective) at once. */
  async chairmanDecide(
    ids: string[],
    approve: boolean,
    note: string | undefined,
    actor: Actor,
  ) {
    let done = 0;
    const failed: Array<{ id: string; error: string }> = [];
    for (const id of ids) {
      try {
        const req = await this.prisma.salaryCorrectionRequest.findUnique({
          where: { id },
        });
        if (!req) throw new NotFoundException('Request not found');
        if (req.status !== SalaryCorrectionStatus.FORWARDED)
          throw new BadRequestException('Not waiting for the Chairman');
        if (approve) await this.apply(req, actor);
        await this.prisma.salaryCorrectionRequest.update({
          where: { id },
          data: {
            status: approve
              ? SalaryCorrectionStatus.APPLIED
              : SalaryCorrectionStatus.CHAIRMAN_REJECTED,
            decisionNote: note?.trim() || null,
            decidedById: actor.id,
            decidedAt: new Date(),
          },
        });
        const impact = Number(req.impactAmount ?? 0);
        await this.notifyEmployee(
          req.employeeId,
          approve
            ? `Your salary correction (${req.month}/${req.year}) was approved: ${impact >= 0 ? '+' : ''}${impact} on your salary.`
            : `Your salary correction (${req.month}/${req.year}) was not approved by the Chairman.${note ? ` ${note}` : ''}`,
        );
        await this.audit(
          actor.id,
          approve
            ? 'SALARY_CORRECTION_APPROVED'
            : 'SALARY_CORRECTION_CHAIRMAN_REJECTED',
          id,
          {
            employeeId: req.employeeId,
            impact,
            note: note ?? null,
          },
        );
        done++;
      } catch (err) {
        failed.push({
          id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { done, failed };
  }

  private async apply(
    req: {
      id: string;
      employeeId: string;
      payrollEntryId: string;
      month: number;
      year: number;
      hrLines: Prisma.JsonValue;
    },
    actor: Actor,
  ) {
    const lines = (req.hrLines ?? []) as Array<
      CorrectionLine & { amount: number }
    >;
    await this.prisma.$transaction(async (tx) => {
      let entry = await tx.payrollEntry.findUnique({
        where: { id: req.payrollEntryId },
      });
      if (!entry) throw new NotFoundException('Salary not found');
      let label = 'Salary correction';
      if (
        entry.status === PayrollStatus.PROCESSED ||
        entry.status === PayrollStatus.PAID
      ) {
        // Already paid: the correction goes on the next open month.
        const after = entry.year * 12 + entry.month;
        const next = (
          await tx.payrollEntry.findMany({
            where: {
              status: PayrollStatus.PENDING,
              stipendRecord: { employeeId: req.employeeId },
            },
            orderBy: [{ year: 'asc' }, { month: 'asc' }],
          })
        ).find((e) => e.year * 12 + e.month > after);
        if (!next) {
          throw new BadRequestException(
            'Salary already paid and no open month yet; approve after the next payroll is generated',
          );
        }
        entry = next;
        label = `Salary correction for ${req.month}/${req.year}`;
      } else if (entry.status !== PayrollStatus.PENDING) {
        // Verified / approved but not paid: back to Finance to verify again.
        await tx.payrollEntry.update({
          where: { id: entry.id },
          data: {
            status: PayrollStatus.PENDING,
            financeVerifiedAt: null,
            financeVerifiedById: null,
          },
        });
      }
      let allowances = 0;
      let deductions = 0;
      for (const l of lines) {
        const what =
          l.kind === 'OVERTIME'
            ? `overtime ${l.hours}h`
            : l.kind === 'EXTRA_DUTY'
              ? `extra duty ${l.days} day(s)`
              : l.note || (l.kind === 'ADD' ? 'addition' : 'deduction');
        if (l.kind === 'DEDUCT') {
          await tx.payrollDeduction.create({
            data: {
              payrollEntryId: entry.id,
              reason: DeductionType.OTHER,
              amount: l.amount,
              description: `${label}: ${what}`,
            },
          });
          deductions += l.amount;
        } else {
          // CUSTOM rows survive payroll recalculation.
          await tx.allowance.create({
            data: {
              payrollEntryId: entry.id,
              type: AllowanceType.CUSTOM,
              description: `${label}: ${what}${l.note && l.kind !== 'ADD' ? ` (${l.note})` : ''}`,
              amount: l.amount,
              hours: l.kind === 'OVERTIME' ? (l.hours ?? null) : null,
            },
          });
          allowances += l.amount;
        }
      }
      const net = allowances - deductions;
      const updated = await tx.payrollEntry.update({
        where: { id: entry.id },
        data: {
          totalAllowances: { increment: allowances },
          totalDeductions: { increment: deductions },
          netStipend: { increment: net },
        },
      });
      await tx.payrollChangeLog.create({
        data: {
          payrollEntryId: entry.id,
          userId: actor.id,
          action: 'SALARY_CORRECTION_APPLIED',
          summary: `${label}: ${net >= 0 ? '+' : ''}${roundMoney(net)} (Chairman approved)`,
          netBefore: Number(updated.netStipend) - net,
          netAfter: Number(updated.netStipend),
        },
      });
      await tx.salaryCorrectionRequest.update({
        where: { id: req.id },
        data: { appliedEntryId: entry.id },
      });
    });
    await this.notifyRole(
      UserRole.PAYROLL_OFFICER,
      `A Chairman-approved salary correction (${req.month}/${req.year}) was added; verify that salary again.`,
    );
  }

  private async notifyEmployee(employeeId: string, message: string) {
    await this.prisma.notification.create({
      data: { employeeId, type: 'SALARY_CORRECTION', message },
    });
  }

  private async notifyRole(role: UserRole, message: string) {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        employeeId: { not: null },
        OR: [{ role }, { additionalRoles: { some: { role } } }],
      },
      select: { employeeId: true },
    });
    for (const u of users) {
      await this.prisma.notification.create({
        data: { employeeId: u.employeeId!, type: 'SALARY_CORRECTION', message },
      });
    }
  }

  private audit(
    userId: string,
    action: string,
    entityId: string,
    changes: object,
  ) {
    return this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entity: 'SalaryCorrectionRequest',
        entityId,
        changes: changes as never,
      },
    });
  }
}

class LineDto {
  @IsIn(['OVERTIME', 'EXTRA_DUTY', 'ADD', 'DEDUCT'])
  kind: CorrectionLine['kind'];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) hours?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) days?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
class HrDecideDto {
  @IsBoolean() accept: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines?: LineDto[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
class ChairmanDecideDto {
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) ids: string[];
  @IsBoolean() approve: boolean;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

type JwtUser = {
  id: string;
  role: UserRole;
  roles?: UserRole[];
  employeeId?: string | null;
};
const HR_OPS: UserRole[] = [
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.SUPER_ADMIN,
];
const CHAIRMAN: UserRole[] = [UserRole.CHAIRMAN, UserRole.SUPER_ADMIN];

@Controller('salary-corrections')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalaryCorrectionController {
  constructor(private service: SalaryCorrectionService) {}

  @Get()
  @Roles(...HR_OPS, ...CHAIRMAN, UserRole.FOUNDER, UserRole.PAYROLL_OFFICER)
  @StrictRoles()
  list(
    @Query('status') status?: SalaryCorrectionStatus,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.list({
      status,
      month: month ? Number(month) : undefined,
      year: year ? Number(year) : undefined,
    });
  }

  @Get('mine')
  @Roles(UserRole.EMPLOYEE)
  mine(@CurrentUser() user: JwtUser) {
    return user.employeeId ? this.service.mine(user.employeeId) : [];
  }

  @Get(':id/rate')
  @Roles(...HR_OPS, ...CHAIRMAN)
  @StrictRoles()
  rate(@Param('id') id: string) {
    return this.service.rate(id);
  }

  @Post(':id/hr')
  @Roles(...HR_OPS)
  @StrictRoles()
  hrDecide(
    @Param('id') id: string,
    @Body() dto: HrDecideDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.hrDecide(id, dto, actorOf(user));
  }

  @Post('chairman')
  @Roles(...CHAIRMAN)
  @StrictRoles()
  chairmanDecide(@Body() dto: ChairmanDecideDto, @CurrentUser() user: JwtUser) {
    return this.service.chairmanDecide(
      dto.ids,
      dto.approve,
      dto.note,
      actorOf(user),
    );
  }
}
