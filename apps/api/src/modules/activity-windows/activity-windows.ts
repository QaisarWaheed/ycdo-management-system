import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Global,
  Injectable,
  Module,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsDateString,
  IsEnum,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PayrollActivity, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAnyRole } from '../../common/user-roles.util';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, StrictRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

/** Req 20.7: executives have no monthly time limit. */
export const ACTIVITY_EXEMPT_ROLES: UserRole[] = [
  UserRole.CHAIRMAN,
  UserRole.PRESIDENT,
  UserRole.FOUNDER,
  UserRole.SUPER_ADMIN,
];

/** Monthly windows in Pakistan time: [day, hour] start → end (end exclusive). */
export const ACTIVITY_WINDOWS: Record<
  PayrollActivity,
  { label: string; from: [number, number]; to: [number, number] }
> = {
  EMPLOYEE_SALARY_REVIEW: { label: 'Salary review', from: [1, 0], to: [3, 12] },
  HR_SALARY_CORRECTIONS: {
    label: 'Salary suggestions (HR Operations)',
    from: [3, 12],
    to: [5, 12],
  },
  DEPT_INCHARGE_SUGGESTIONS: {
    label: 'Incentive / allowance suggestions',
    from: [1, 0],
    to: [5, 12],
  },
  FINANCE_VERIFICATION: {
    label: 'Finance verification',
    from: [5, 12],
    to: [8, 0],
  },
  PC_PROOF_READING: {
    label: 'Proof-reading (Project Coordinator)',
    from: [7, 0],
    to: [11, 0],
  },
};

const PKT_MS = 5 * 3600_000;
const pktDate = (y: number, m: number, d: number, h: number) =>
  new Date(Date.UTC(y, m - 1, d, h) - PKT_MS);

/**
 * The window of `activity` in the current Pakistan month (it is about the
 * previous month's salary), and whether `now` is inside it.
 */
export function activityWindow(
  activity: PayrollActivity,
  now: Date = new Date(),
) {
  const pk = new Date(now.getTime() + PKT_MS);
  const y = pk.getUTCFullYear();
  const m = pk.getUTCMonth() + 1;
  const w = ACTIVITY_WINDOWS[activity];
  const opensAt = pktDate(y, m, w.from[0], w.from[1]);
  const closesAt = pktDate(y, m, w.to[0], w.to[1]);
  const prev = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  return {
    activity,
    label: w.label,
    open: now >= opensAt && now < closesAt,
    opensAt,
    closesAt,
    payrollYear: prev.year,
    payrollMonth: prev.month,
  };
}

type Actor = { id: string; roles: UserRole[] };

@Injectable()
export class ActivityWindowsService {
  constructor(private prisma: PrismaService) {}

  /** Open for this user now: executive, inside the window, or an active IT extension. */
  async status(
    activity: PayrollActivity,
    actor: Actor,
    now: Date = new Date(),
  ) {
    const w = activityWindow(activity, now);
    if (hasAnyRole(actor.roles, ACTIVITY_EXEMPT_ROLES))
      return { ...w, open: true, exempt: true, extensionUntil: null };
    if (w.open) return { ...w, exempt: false, extensionUntil: null };
    const ext = await this.prisma.activityExtension.findFirst({
      where: {
        userId: actor.id,
        activity,
        revokedAt: null,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      orderBy: { endsAt: 'desc' },
    });
    return {
      ...w,
      open: !!ext,
      exempt: false,
      extensionUntil: ext?.endsAt ?? null,
    };
  }

  async assertOpen(activity: PayrollActivity, actor: Actor) {
    const s = await this.status(activity, actor);
    if (!s.open) {
      const fmt = (d: Date) =>
        new Date(d.getTime() + PKT_MS)
          .toISOString()
          .slice(0, 16)
          .replace('T', ' ');
      throw new ForbiddenException(
        `${s.label} is closed (window ${fmt(s.opensAt)} – ${fmt(s.closesAt)} PKT). Ask IT for an extension if needed.`,
      );
    }
  }

  /**
   * Req 20.5: after the Finance window closes, Finance can no longer amend
   * last month's salaries (executives and IT extensions excepted).
   */
  async assertFinanceEdit(
    actor: Actor,
    ref: { entryId?: string; deductionId?: string },
  ) {
    if (hasAnyRole(actor.roles, ACTIVITY_EXEMPT_ROLES)) return;
    if (!actor.roles.includes(UserRole.PAYROLL_OFFICER)) return;
    const entry = ref.entryId
      ? await this.prisma.payrollEntry.findUnique({
          where: { id: ref.entryId },
          select: { month: true, year: true },
        })
      : ref.deductionId
        ? (
            await this.prisma.payrollDeduction.findUnique({
              where: { id: ref.deductionId },
              select: { payrollEntry: { select: { month: true, year: true } } },
            })
          )?.payrollEntry
        : null;
    if (!entry) return;
    const w = activityWindow(PayrollActivity.FINANCE_VERIFICATION);
    if (entry.month !== w.payrollMonth || entry.year !== w.payrollYear) return;
    if (new Date() < w.closesAt) return;
    await this.assertOpen(PayrollActivity.FINANCE_VERIFICATION, actor);
  }

  async mine(actor: Actor) {
    return Promise.all(
      (Object.keys(ACTIVITY_WINDOWS) as PayrollActivity[]).map((a) =>
        this.status(a, actor),
      ),
    );
  }

  listExtensions() {
    return this.prisma.activityExtension.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: {
          select: {
            email: true,
            role: true,
            employee: { select: { fullName: true } },
          },
        },
      },
    });
  }

  async grant(
    dto: {
      userId: string;
      activity: PayrollActivity;
      startsAt: string;
      endsAt: string;
      reason: string;
    },
    grantedById: string,
  ) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt)
      throw new BadRequestException('End must be after start');
    const ext = await this.prisma.activityExtension.create({
      data: {
        userId: dto.userId,
        activity: dto.activity,
        startsAt,
        endsAt,
        reason: dto.reason.trim(),
        grantedById,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: grantedById,
        action: 'ACTIVITY_EXTENSION_GRANTED',
        entity: 'ActivityExtension',
        entityId: ext.id,
        changes: {
          userId: dto.userId,
          activity: dto.activity,
          startsAt,
          endsAt,
          reason: ext.reason,
        },
      },
    });
    return ext;
  }

  async revoke(id: string, actorId: string) {
    const ext = await this.prisma.activityExtension.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'ACTIVITY_EXTENSION_REVOKED',
        entity: 'ActivityExtension',
        entityId: id,
      },
    });
    return ext;
  }
}

class GrantExtensionDto {
  @IsUUID() userId: string;
  @IsEnum(PayrollActivity) activity: PayrollActivity;
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

type JwtUser = { id: string; role: UserRole; roles?: UserRole[] };
export const actorOf = (u: JwtUser): Actor => ({
  id: u.id,
  roles: u.roles?.length ? u.roles : [u.role],
});

@Controller('activity-windows')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ActivityWindowsController {
  constructor(private service: ActivityWindowsService) {}

  /** For the screens: which of my payroll activities are open now. */
  @Get('me')
  mine(@CurrentUser() user: JwtUser) {
    return this.service.mine(actorOf(user));
  }

  @Get('extensions')
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  @StrictRoles()
  list() {
    return this.service.listExtensions();
  }

  @Post('extensions')
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  @StrictRoles()
  grant(@Body() dto: GrantExtensionDto, @CurrentUser() user: JwtUser) {
    return this.service.grant(dto, user.id);
  }

  @Post('extensions/:id/revoke')
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  @StrictRoles()
  revoke(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.revoke(id, user.id);
  }
}

@Global()
@Module({
  imports: [AuthModule],
  controllers: [ActivityWindowsController],
  providers: [ActivityWindowsService],
  exports: [ActivityWindowsService],
})
export class ActivityWindowsModule {}
