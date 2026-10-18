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
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PayrollAmendmentStatus,
  PayrollStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, StrictRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

export const AMENDMENT_HR_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
];
export const AMENDMENT_FINANCE_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.PAYROLL_OFFICER,
];
export const AMENDMENT_FOUNDER_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.FOUNDER,
];

type Actor = { id: string };

/**
 * Phase 3 Req 12: a Finance-verified salary slip is locked. To change it, HR
 * issues an amendment notification → Finance submits it to the Founder →
 * the Founder approves (slip back to Pending so Finance can edit, then
 * Verify again) or rejects (slip stays as verified).
 */
@Injectable()
export class PayrollAmendmentService {
  constructor(private prisma: PrismaService) {}

  list(status?: PayrollAmendmentStatus) {
    return this.prisma.payrollAmendmentRequest.findMany({
      where: status ? { status } : {},
      orderBy: { notifiedAt: 'desc' },
      take: 200,
      include: {
        payrollEntry: {
          select: {
            netStipend: true,
            status: true,
            stipendRecord: {
              select: {
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
        },
      },
    });
  }

  async notify(
    dto: { payrollEntryId: string; notification: string },
    actor: Actor,
  ) {
    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: dto.payrollEntryId },
      include: {
        stipendRecord: {
          select: {
            employeeId: true,
            employee: { select: { fullName: true } },
          },
        },
      },
    });
    if (!entry) throw new NotFoundException('Salary slip not found');
    if (entry.status !== PayrollStatus.VERIFIED) {
      throw new BadRequestException(
        entry.status === PayrollStatus.PENDING
          ? 'This slip is not verified; Finance can still edit it directly'
          : 'This slip is already processed / paid',
      );
    }
    const open = await this.prisma.payrollAmendmentRequest.findFirst({
      where: {
        payrollEntryId: entry.id,
        status: {
          in: [
            PayrollAmendmentStatus.HR_NOTIFIED,
            PayrollAmendmentStatus.SUBMITTED,
          ],
        },
      },
    });
    if (open)
      throw new BadRequestException(
        'An amendment for this slip is already open',
      );
    const req = await this.prisma.payrollAmendmentRequest.create({
      data: {
        payrollEntryId: entry.id,
        employeeId: entry.stipendRecord.employeeId,
        month: entry.month,
        year: entry.year,
        notification: dto.notification.trim(),
        notifiedById: actor.id,
      },
    });
    await this.notifyRole(
      UserRole.PAYROLL_OFFICER,
      `Amendment notification for ${entry.stipendRecord.employee.fullName} (${entry.month}/${entry.year}): ${req.notification}. Submit it to the Founder for approval.`,
    );
    await this.audit(actor.id, 'PAYROLL_AMENDMENT_NOTIFIED', req.id, {
      employeeId: req.employeeId,
      payrollEntryId: entry.id,
      notification: req.notification,
    });
    return req;
  }

  async submit(id: string, note: string | undefined, actor: Actor) {
    const req = await this.load(id);
    if (req.status !== PayrollAmendmentStatus.HR_NOTIFIED) {
      throw new BadRequestException(
        'Only a new HR notification can be submitted',
      );
    }
    const updated = await this.prisma.payrollAmendmentRequest.update({
      where: { id },
      data: {
        status: PayrollAmendmentStatus.SUBMITTED,
        financeNote: note?.trim() || null,
        submittedById: actor.id,
        submittedAt: new Date(),
      },
    });
    await this.notifyRole(
      UserRole.FOUNDER,
      `Salary slip amendment (${req.month}/${req.year}) awaits your approval: ${req.notification}`,
    );
    await this.audit(actor.id, 'PAYROLL_AMENDMENT_SUBMITTED', id, {
      employeeId: req.employeeId,
      note: note ?? null,
    });
    return updated;
  }

  async decide(
    id: string,
    approve: boolean,
    note: string | undefined,
    actor: Actor,
  ) {
    const req = await this.load(id);
    if (req.status !== PayrollAmendmentStatus.SUBMITTED) {
      throw new BadRequestException(
        'This amendment is not waiting for the Founder',
      );
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payrollAmendmentRequest.updateMany({
        where: { id, status: PayrollAmendmentStatus.SUBMITTED },
        data: {
          status: approve
            ? PayrollAmendmentStatus.APPROVED
            : PayrollAmendmentStatus.REJECTED,
          decidedById: actor.id,
          decidedAt: now,
          decisionNote: note?.trim() || null,
        },
      });
      if (claimed.count !== 1) throw new BadRequestException('Already decided');
      if (approve) {
        // The authorised amendment: Finance can edit again, then Verify again.
        const reopened = await tx.payrollEntry.updateMany({
          where: { id: req.payrollEntryId, status: PayrollStatus.VERIFIED },
          data: {
            status: PayrollStatus.PENDING,
            financeVerifiedAt: null,
            financeVerifiedById: null,
          },
        });
        if (reopened.count !== 1) {
          throw new BadRequestException(
            'The slip is no longer verified (already processed / paid)',
          );
        }
        await tx.payrollChangeLog.create({
          data: {
            payrollEntryId: req.payrollEntryId,
            userId: actor.id,
            action: 'AMENDMENT_APPROVED',
            summary: `Founder approved amendment: ${req.notification}`,
          },
        });
      }
    });
    await this.notifyRole(
      UserRole.PAYROLL_OFFICER,
      approve
        ? `Founder approved the amendment (${req.month}/${req.year}); the slip is open for editing. Verify it again when done.`
        : `Founder rejected the amendment (${req.month}/${req.year}); the verified slip stays unchanged.`,
    );
    await this.audit(
      actor.id,
      approve ? 'PAYROLL_AMENDMENT_APPROVED' : 'PAYROLL_AMENDMENT_REJECTED',
      id,
      {
        employeeId: req.employeeId,
        note: note ?? null,
      },
    );
    return {
      id,
      status: approve
        ? PayrollAmendmentStatus.APPROVED
        : PayrollAmendmentStatus.REJECTED,
    };
  }

  private async load(id: string) {
    const req = await this.prisma.payrollAmendmentRequest.findUnique({
      where: { id },
    });
    if (!req) throw new NotFoundException('Amendment not found');
    return req;
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
        data: { employeeId: u.employeeId!, type: 'PAYROLL_AMENDMENT', message },
      });
    }
  }

  private audit(
    userId: string,
    action: string,
    entityId: string,
    changes: Prisma.InputJsonValue,
  ) {
    return this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entity: 'PayrollAmendmentRequest',
        entityId,
        changes,
      },
    });
  }
}

class NotifyAmendmentDto {
  @IsUUID() payrollEntryId: string;
  @IsString() @MinLength(5) @MaxLength(1000) notification: string;
}
class AmendmentNoteDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

type JwtUser = { id: string };

@Controller('payroll-amendments')
@UseGuards(JwtAuthGuard, RolesGuard)
@StrictRoles()
export class PayrollAmendmentController {
  constructor(private service: PayrollAmendmentService) {}

  @Get()
  @Roles(
    ...AMENDMENT_HR_ROLES,
    ...AMENDMENT_FINANCE_ROLES,
    ...AMENDMENT_FOUNDER_ROLES,
  )
  list(@Query('status') status?: PayrollAmendmentStatus) {
    return this.service.list(status);
  }

  @Post()
  @Roles(...AMENDMENT_HR_ROLES)
  notify(@Body() dto: NotifyAmendmentDto, @CurrentUser() user: JwtUser) {
    return this.service.notify(dto, user);
  }

  @Post(':id/submit')
  @Roles(...AMENDMENT_FINANCE_ROLES)
  submit(
    @Param('id') id: string,
    @Body() dto: AmendmentNoteDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.submit(id, dto.note, user);
  }

  @Post(':id/approve')
  @Roles(...AMENDMENT_FOUNDER_ROLES)
  approve(
    @Param('id') id: string,
    @Body() dto: AmendmentNoteDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.decide(id, true, dto.note, user);
  }

  @Post(':id/reject')
  @Roles(...AMENDMENT_FOUNDER_ROLES)
  reject(
    @Param('id') id: string,
    @Body() dto: AmendmentNoteDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.decide(id, false, dto.note, user);
  }
}
