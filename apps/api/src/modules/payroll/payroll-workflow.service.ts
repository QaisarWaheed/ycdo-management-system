import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  PayrollActivity,
  PayrollReviewKind,
  PayrollReviewStatus,
  PayrollStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAnyRole } from '../../common/user-roles.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, StrictRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  ActivityWindowsService,
  actorOf,
} from '../activity-windows/activity-windows';
import { PayrollService } from './payroll.service';

type Actor = { id: string; roles: UserRole[] };
const FOUNDER: UserRole[] = [UserRole.FOUNDER, UserRole.SUPER_ADMIN];
const PC: UserRole[] = [UserRole.PROJECT_COORDINATOR, UserRole.SUPER_ADMIN];
const FINANCE: UserRole[] = [UserRole.PAYROLL_OFFICER, UserRole.SUPER_ADMIN];

/**
 * Req 20.5 / 20.6 + proof-reading: Finance verifies (or sends a correction to
 * whoever made the entry) → Founder approves → Project Coordinator proof-reads
 * (verify, or raise an issue the Founder reviews: resolve, or reopen the slip
 * for Finance) → PC Verified → Finance processes and pays.
 */
@Injectable()
export class PayrollWorkflowService {
  constructor(
    private prisma: PrismaService,
    private payroll: PayrollService,
    private windows: ActivityWindowsService,
  ) {}

  entries(q: {
    month: number;
    year: number;
    status?: PayrollStatus;
    branchId?: string;
  }) {
    return this.prisma.payrollEntry.findMany({
      where: {
        month: q.month,
        year: q.year,
        ...(q.status ? { status: q.status } : {}),
        ...(q.branchId
          ? { stipendRecord: { employee: { currentBranchId: q.branchId } } }
          : {}),
      },
      orderBy: { stipendRecord: { employee: { fullName: 'asc' } } },
      select: {
        id: true,
        status: true,
        basicStipend: true,
        totalAllowances: true,
        totalDeductions: true,
        netStipend: true,
        financeVerifiedAt: true,
        stipendRecord: {
          select: {
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                currentDesignation: true,
                currentBranch: { select: { name: true } },
                currentDepartment: { select: { name: true } },
              },
            },
          },
        },
        reviewIssues: {
          where: { status: { not: PayrollReviewStatus.CLOSED } },
          select: {
            id: true,
            kind: true,
            status: true,
            note: true,
            response: true,
          },
        },
      },
    });
  }

  /** Founder / CEO final approval of Finance-verified salaries. */
  founderApprove(entryIds: string[], actor: Actor) {
    return this.move(
      entryIds,
      PayrollStatus.VERIFIED,
      PayrollStatus.FOUNDER_APPROVED,
      actor,
    );
  }

  /** Project Coordinator proof-reading: verify Founder-approved salaries with no open issue. */
  async pcVerify(entryIds: string[], actor: Actor) {
    await this.windows.assertOpen(PayrollActivity.PC_PROOF_READING, actor);
    const blocked = await this.prisma.payrollReviewIssue.findMany({
      where: {
        payrollEntryId: { in: entryIds },
        kind: PayrollReviewKind.PC_PROOF_READING,
        status: PayrollReviewStatus.OPEN,
      },
      select: { payrollEntryId: true },
    });
    const skip = new Set(blocked.map((b) => b.payrollEntryId));
    const ok = entryIds.filter((id) => !skip.has(id));
    const result = await this.move(
      ok,
      PayrollStatus.FOUNDER_APPROVED,
      PayrollStatus.PC_VERIFIED,
      actor,
    );
    // Issues the Founder already reviewed are settled once the PC verifies.
    await this.prisma.payrollReviewIssue.updateMany({
      where: {
        payrollEntryId: { in: ok },
        kind: PayrollReviewKind.PC_PROOF_READING,
        status: PayrollReviewStatus.RESPONDED,
      },
      data: { status: PayrollReviewStatus.CLOSED },
    });
    return {
      ...result,
      failed: [
        ...result.failed,
        ...[...skip].map((id) => ({
          entryId: id,
          error: 'Open proof-reading issue with the Founder',
        })),
      ],
    };
  }

  private async move(
    entryIds: string[],
    from: PayrollStatus,
    to: PayrollStatus,
    actor: Actor,
  ) {
    let done = 0;
    const failed: Array<{ entryId: string; error: string }> = [];
    for (const id of entryIds) {
      try {
        const entry = await this.prisma.payrollEntry.findUnique({
          where: { id },
          select: { status: true },
        });
        if (entry?.status !== from)
          throw new BadRequestException(`Salary is not ${from}`);
        await this.payroll.updateStatus(id, { status: to }, actor.id);
        done++;
      } catch (err) {
        failed.push({
          entryId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { done, failed };
  }

  async raise(
    dto: {
      entryId: string;
      kind: PayrollReviewKind;
      note: string;
      lineKind?: string;
      lineId?: string;
      assignedToId?: string;
    },
    actor: Actor,
  ) {
    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: dto.entryId },
      include: {
        stipendRecord: { select: { employee: { select: { fullName: true } } } },
      },
    });
    if (!entry) throw new NotFoundException('Salary not found');
    const who = `${entry.stipendRecord.employee.fullName} (${entry.month}/${entry.year})`;
    let assignedToId: string | null = null;
    if (dto.kind === PayrollReviewKind.PC_PROOF_READING) {
      if (!hasAnyRole(actor.roles, PC))
        throw new ForbiddenException(
          'Only the Project Coordinator proof-reads',
        );
      await this.windows.assertOpen(PayrollActivity.PC_PROOF_READING, actor);
      if (entry.status !== PayrollStatus.FOUNDER_APPROVED) {
        throw new BadRequestException(
          'Only Founder-approved salaries are proof-read',
        );
      }
    } else {
      if (!hasAnyRole(actor.roles, FINANCE))
        throw new ForbiddenException('Only Finance raises corrections');
      await this.windows.assertOpen(
        PayrollActivity.FINANCE_VERIFICATION,
        actor,
      );
      if (entry.status !== PayrollStatus.PENDING) {
        throw new BadRequestException(
          'Corrections are raised before Finance verifies the slip',
        );
      }
      assignedToId =
        dto.assignedToId ?? (await this.entryOwner(dto.lineKind, dto.lineId));
      if (!assignedToId)
        throw new BadRequestException('Choose who must correct this entry');
    }
    const issue = await this.prisma.payrollReviewIssue.create({
      data: {
        payrollEntryId: entry.id,
        kind: dto.kind,
        raisedById: actor.id,
        assignedToId,
        lineKind: dto.lineKind ?? null,
        lineId: dto.lineId ?? null,
        note: dto.note.trim(),
      },
    });
    if (dto.kind === PayrollReviewKind.PC_PROOF_READING) {
      await this.notifyRole(
        UserRole.FOUNDER,
        `Proof-reading issue on ${who}: ${issue.note}`,
      );
    } else {
      await this.notifyUser(
        assignedToId!,
        `Finance correction on ${who}: ${issue.note}. Correct it and send it back.`,
      );
    }
    await this.audit(actor.id, `PAYROLL_${dto.kind}_RAISED`, issue.id, {
      payrollEntryId: entry.id,
      note: issue.note,
    });
    return issue;
  }

  /** Who made the line: incentive / package allowance creator. */
  private async entryOwner(
    lineKind?: string,
    lineId?: string,
  ): Promise<string | null> {
    if (!lineId) return null;
    if (lineKind === 'INCENTIVE') {
      return (
        (
          await this.prisma.incentive.findUnique({
            where: { id: lineId },
            select: { addedBy: true },
          })
        )?.addedBy ?? null
      );
    }
    if (lineKind === 'ALLOWANCE') {
      return (
        (
          await this.prisma.employeeAllowance.findUnique({
            where: { id: lineId },
            select: { createdById: true },
          })
        )?.createdById ?? null
      );
    }
    return null;
  }

  /** People Finance can send a correction to (whoever makes payroll entries). */
  assignees() {
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        role: {
          in: [
            UserRole.HR_MANAGER,
            UserRole.HR_ADMIN_MANAGER,
            UserRole.HR_OPERATIONS_MANAGER,
            UserRole.HR_EXECUTIVE,
            UserRole.DEPARTMENT_HEAD,
            UserRole.PRESIDENT,
            UserRole.FOUNDER,
            UserRole.CHAIRMAN,
          ],
        },
      },
      select: {
        id: true,
        email: true,
        role: true,
        employee: { select: { fullName: true } },
      },
      orderBy: { email: 'asc' },
    });
  }

  issues(q: { kind?: PayrollReviewKind; assignedToId?: string }) {
    return this.prisma.payrollReviewIssue.findMany({
      where: {
        status: { not: PayrollReviewStatus.CLOSED },
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        payrollEntry: {
          select: {
            id: true,
            month: true,
            year: true,
            status: true,
            netStipend: true,
            stipendRecord: {
              select: {
                employee: {
                  select: { id: true, fullName: true, employeeCode: true },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * FINANCE_CORRECTION: the assigned person answers after correcting.
   * PC_PROOF_READING: the Founder resolves (no change) or reopens the slip
   * for Finance (back to Pending → re-verify → Founder → PC again).
   */
  async respond(
    id: string,
    dto: { response: string; reopen?: boolean },
    actor: Actor,
  ) {
    const issue = await this.prisma.payrollReviewIssue.findUnique({
      where: { id },
      include: { payrollEntry: { select: { month: true, year: true } } },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    if (issue.status !== PayrollReviewStatus.OPEN)
      throw new BadRequestException('Already answered');
    if (issue.kind === PayrollReviewKind.FINANCE_CORRECTION) {
      if (
        issue.assignedToId !== actor.id &&
        !actor.roles.includes(UserRole.SUPER_ADMIN)
      ) {
        throw new ForbiddenException(
          'This correction is assigned to someone else',
        );
      }
    } else if (!hasAnyRole(actor.roles, FOUNDER)) {
      throw new ForbiddenException(
        'Only the Founder reviews proof-reading issues',
      );
    }
    if (issue.kind === PayrollReviewKind.PC_PROOF_READING && dto.reopen) {
      const reopened = await this.prisma.payrollEntry.updateMany({
        where: {
          id: issue.payrollEntryId,
          status: PayrollStatus.FOUNDER_APPROVED,
        },
        data: {
          status: PayrollStatus.PENDING,
          financeVerifiedAt: null,
          financeVerifiedById: null,
        },
      });
      if (reopened.count !== 1)
        throw new BadRequestException(
          'The salary is no longer Founder-approved',
        );
      await this.prisma.payrollChangeLog.create({
        data: {
          payrollEntryId: issue.payrollEntryId,
          userId: actor.id,
          action: 'REOPENED_FROM_PROOF_READING',
          summary: `Founder reopened for correction: ${issue.note}`,
        },
      });
      await this.notifyRole(
        UserRole.PAYROLL_OFFICER,
        `Founder reopened a salary (${issue.payrollEntry.month}/${issue.payrollEntry.year}) after proof-reading: ${issue.note}. Correct and verify it again.`,
      );
    }
    const updated = await this.prisma.payrollReviewIssue.update({
      where: { id },
      data: {
        status: PayrollReviewStatus.RESPONDED,
        response: dto.response.trim(),
        respondedById: actor.id,
        respondedAt: new Date(),
      },
    });
    await this.notifyUser(
      issue.raisedById,
      `Your ${issue.kind === PayrollReviewKind.PC_PROOF_READING ? 'proof-reading issue' : 'correction'} was answered: ${dto.response.trim()}`,
    );
    await this.audit(actor.id, `PAYROLL_${issue.kind}_RESPONDED`, id, {
      reopen: !!dto.reopen,
      response: dto.response.trim(),
    });
    return updated;
  }

  /**
   * The assigned person corrects only the deduction the correction is about
   * (incentives / allowances are changed on their own pages, then answered).
   */
  async correctLine(id: string, amount: number, actor: Actor) {
    const issue = await this.prisma.payrollReviewIssue.findUnique({
      where: { id },
    });
    if (!issue || issue.kind !== PayrollReviewKind.FINANCE_CORRECTION)
      throw new NotFoundException('Correction not found');
    if (issue.status !== PayrollReviewStatus.OPEN)
      throw new BadRequestException('Already answered');
    if (
      issue.assignedToId !== actor.id &&
      !actor.roles.includes(UserRole.SUPER_ADMIN)
    ) {
      throw new ForbiddenException(
        'This correction is assigned to someone else',
      );
    }
    if (issue.lineKind !== 'DEDUCTION' || !issue.lineId) {
      throw new BadRequestException(
        'Change this entry on its own page, then send the correction back',
      );
    }
    await this.payroll.updateDeduction(
      issue.lineId,
      { amount } as never,
      actor.id,
    );
    await this.audit(actor.id, 'PAYROLL_FINANCE_CORRECTION_LINE', id, {
      lineId: issue.lineId,
      amount,
    });
    return { id, amount };
  }

  async close(id: string, actor: Actor) {
    const issue = await this.prisma.payrollReviewIssue.findUnique({
      where: { id },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    if (
      issue.raisedById !== actor.id &&
      !actor.roles.includes(UserRole.SUPER_ADMIN)
    ) {
      throw new ForbiddenException('Only who raised it can close it');
    }
    return this.prisma.payrollReviewIssue.update({
      where: { id },
      data: { status: PayrollReviewStatus.CLOSED },
    });
  }

  private async notifyUser(userId: string, message: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { employeeId: true },
    });
    if (u?.employeeId) {
      await this.prisma.notification.create({
        data: { employeeId: u.employeeId, type: 'PAYROLL_REVIEW', message },
      });
    }
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
        data: { employeeId: u.employeeId!, type: 'PAYROLL_REVIEW', message },
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
        entity: 'PayrollReviewIssue',
        entityId,
        changes: changes as never,
      },
    });
  }
}

class EntriesQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month: number;
  @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year: number;
  @IsOptional() @IsEnum(PayrollStatus) status?: PayrollStatus;
  @IsOptional() @IsUUID() branchId?: string;
}
class EntryIdsDto {
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) entryIds: string[];
}
class RaiseDto {
  @IsUUID() entryId: string;
  @IsEnum(PayrollReviewKind) kind: PayrollReviewKind;
  @IsString() @MinLength(3) @MaxLength(1000) note: string;
  @IsOptional()
  @IsIn(['INCENTIVE', 'ALLOWANCE', 'DEDUCTION', 'OTHER'])
  lineKind?: string;
  @IsOptional() @IsUUID() lineId?: string;
  @IsOptional() @IsUUID() assignedToId?: string;
}
class RespondDto {
  @IsString() @MinLength(2) @MaxLength(1000) response: string;
  @IsOptional() @IsBoolean() reopen?: boolean;
}
class LineDto {
  @Type(() => Number) @IsNumber() @Min(0) amount: number;
}

type JwtUser = { id: string; role: UserRole; roles?: UserRole[] };
const VIEW: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.FOUNDER,
  UserRole.PRESIDENT,
  UserRole.CHAIRMAN,
  UserRole.PROJECT_COORDINATOR,
  UserRole.PAYROLL_OFFICER,
];

@Controller('payroll-workflow')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayrollWorkflowController {
  constructor(private service: PayrollWorkflowService) {}

  @Get('entries')
  @Roles(...VIEW)
  @StrictRoles()
  entries(@Query() q: EntriesQuery) {
    return this.service.entries(q);
  }

  @Post('founder-approve')
  @Roles(...FOUNDER)
  @StrictRoles()
  founderApprove(@Body() dto: EntryIdsDto, @CurrentUser() user: JwtUser) {
    return this.service.founderApprove(dto.entryIds, actorOf(user));
  }

  @Post('pc-verify')
  @Roles(...PC)
  @StrictRoles()
  pcVerify(@Body() dto: EntryIdsDto, @CurrentUser() user: JwtUser) {
    return this.service.pcVerify(dto.entryIds, actorOf(user));
  }

  @Post('issues')
  @Roles(...PC, ...FINANCE)
  @StrictRoles()
  raise(@Body() dto: RaiseDto, @CurrentUser() user: JwtUser) {
    return this.service.raise(dto, actorOf(user));
  }

  @Get('assignees')
  @Roles(...FINANCE)
  @StrictRoles()
  assignees() {
    return this.service.assignees();
  }

  /** Open issues; `mine=1` = corrections assigned to me (any HRMS login). */
  @Get('issues')
  issues(
    @Query('kind') kind: PayrollReviewKind | undefined,
    @Query('mine') mine: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    if (mine === '1')
      return this.service.issues({ kind, assignedToId: user.id });
    if (!hasAnyRole(actorOf(user).roles, VIEW)) throw new ForbiddenException();
    return this.service.issues({ kind });
  }

  @Post('issues/:id/respond')
  respond(
    @Param('id') id: string,
    @Body() dto: RespondDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.respond(id, dto, actorOf(user));
  }

  @Patch('issues/:id/line')
  correctLine(
    @Param('id') id: string,
    @Body() dto: LineDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.correctLine(id, dto.amount, actorOf(user));
  }

  @Post('issues/:id/close')
  close(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.close(id, actorOf(user));
  }
}
