import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  ChangeType,
  EmployeeChangeKind,
  EmployeeChangeStatus,
  LetterType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAnyRole } from '../../common/user-roles.util';
import { dutyWindowMismatch, formatDuty12h } from '../../common/duty.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { LettersService } from '../letters/letters.service';
import { EmployeesService } from './employees.service';

/** HR roles that raise transfer / working-hours requests. */
export const CHANGE_REQUEST_HR_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
];
/** Req 16: HR Operations approves transfers. Req 17: executives approve working hours. */
export const APPROVERS: Record<EmployeeChangeKind, UserRole[]> = {
  TRANSFER: [UserRole.HR_OPERATIONS_MANAGER, UserRole.SUPER_ADMIN],
  WORKING_HOURS: [
    UserRole.CHAIRMAN,
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.SUPER_ADMIN,
  ],
};

type Actor = { id: string; role: UserRole; roles: UserRole[] };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class TransferRequestDto {
  @IsUUID() employeeId: string;
  @IsUUID() currentBranchId: string;
  @IsUUID() currentDepartmentId: string;
  @IsString() @MinLength(2) currentDesignation: string;
  @IsOptional() @IsEnum(ChangeType) changeType?: ChangeType;
  @IsString() @MinLength(3) @MaxLength(500) changeReason: string;
  @IsDateString() effectiveDate: string;
  @IsOptional() @Matches(HHMM) dutyStartTime?: string;
  @IsOptional() @Matches(HHMM) dutyEndTime?: string;
  @IsOptional() @Type(() => Number) @IsNumber() dutyTotalHours?: number;
}

class WorkingHoursRequestDto {
  @IsUUID() employeeId: string;
  @Matches(HHMM) dutyStartTime: string;
  @Matches(HHMM) dutyEndTime: string;
  @Type(() => Number) @IsNumber() dutyTotalHours: number;
  @IsDateString() effectiveDate: string;
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

class DecideDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * Phase 3 Req 16 / 17: branch / department transfer and working-hours change
 * only through a request with a draft letter and a notification. Nothing on
 * the employee changes until approval (transfer: HR Operations; working
 * hours: Chairman / President / Founder). HR sends the letter from Letters as
 * usual; IT can reverse it. Super Admin may still change data directly.
 */
@Injectable()
export class EmployeeChangeRequestService {
  constructor(
    private prisma: PrismaService,
    private employees: EmployeesService,
    private letters: LettersService,
  ) {}

  list(q: {
    status?: EmployeeChangeStatus;
    employeeId?: string;
    kind?: EmployeeChangeKind;
  }) {
    return this.prisma.employeeChangeRequest.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
      },
      orderBy: { requestedAt: 'desc' },
      take: 200,
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
    });
  }

  async requestTransfer(dto: TransferRequestDto, actor: Actor) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: { currentBranch: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const [toBranch, toDept] = await Promise.all([
      this.prisma.branch.findUnique({ where: { id: dto.currentBranchId } }),
      this.prisma.department.findUnique({
        where: { id: dto.currentDepartmentId },
      }),
    ]);
    if (!toBranch || !toDept)
      throw new BadRequestException('Branch or department not found');
    if (dto.dutyStartTime && dto.dutyEndTime && dto.dutyTotalHours != null) {
      const bad = dutyWindowMismatch(
        dto.dutyStartTime,
        dto.dutyEndTime,
        dto.dutyTotalHours,
      );
      if (bad) throw new BadRequestException(bad);
    }
    await this.assertNoOpen(dto.employeeId, EmployeeChangeKind.TRANSFER);
    const timing =
      dto.dutyStartTime && dto.dutyEndTime
        ? `${formatDuty12h(dto.dutyStartTime)} - ${formatDuty12h(dto.dutyEndTime)}`
        : '';
    const letter = await this.letters.generate(
      {
        employeeId: dto.employeeId,
        letterType: LetterType.TRANSFER,
        extraFields: {
          fromPosting: employee.currentBranch?.name ?? '',
          toPosting: `${toBranch.name} (${toDept.name})`,
          targetDesignation: dto.currentDesignation,
          effectiveDate: dto.effectiveDate.slice(0, 10),
          timing,
        },
      },
      actor.id,
      actor.role,
    );
    const summary = `Transfer ${employee.currentBranch?.name ?? '—'} → ${toBranch.name} / ${toDept.name} as ${dto.currentDesignation} from ${dto.effectiveDate.slice(0, 10)}`;
    return this.create(
      dto.employeeId,
      EmployeeChangeKind.TRANSFER,
      dto,
      summary,
      letter,
      actor,
    );
  }

  async requestWorkingHours(dto: WorkingHoursRequestDto, actor: Actor) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const bad = dutyWindowMismatch(
      dto.dutyStartTime,
      dto.dutyEndTime,
      dto.dutyTotalHours,
    );
    if (bad) throw new BadRequestException(bad);
    await this.assertNoOpen(dto.employeeId, EmployeeChangeKind.WORKING_HOURS);
    const from =
      employee.dutyStartTime && employee.dutyEndTime
        ? `${formatDuty12h(employee.dutyStartTime)} - ${formatDuty12h(employee.dutyEndTime)} (${employee.dutyTotalHours ?? '—'}h)`
        : 'not set';
    const to = `${formatDuty12h(dto.dutyStartTime)} - ${formatDuty12h(dto.dutyEndTime)} (${dto.dutyTotalHours}h)`;
    const letter = await this.letters.generate(
      {
        employeeId: dto.employeeId,
        letterType: LetterType.CUSTOM,
        extraFields: {
          subject: 'Change of Working Hours',
          letterBody: `Your working hours are changed from ${from} to ${to} with effect from ${dto.effectiveDate.slice(0, 10)}. Reason: ${dto.reason.trim()}`,
        },
      },
      actor.id,
      actor.role,
    );
    const summary = `Working hours ${from} → ${to} from ${dto.effectiveDate.slice(0, 10)}`;
    return this.create(
      dto.employeeId,
      EmployeeChangeKind.WORKING_HOURS,
      dto,
      summary,
      letter,
      actor,
    );
  }

  async decide(
    id: string,
    approve: boolean,
    note: string | undefined,
    actor: Actor,
  ) {
    const req = await this.prisma.employeeChangeRequest.findUnique({
      where: { id },
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== EmployeeChangeStatus.PENDING)
      throw new BadRequestException('Already decided');
    if (!hasAnyRole(actor.roles, APPROVERS[req.kind])) {
      throw new ForbiddenException(
        req.kind === EmployeeChangeKind.TRANSFER
          ? 'Only HR Operations can approve a transfer'
          : 'Only the Chairman, President or Founder can approve working hours',
      );
    }
    if (
      req.requestedById === actor.id &&
      !actor.roles.includes(UserRole.SUPER_ADMIN)
    ) {
      throw new ForbiddenException('You cannot approve your own request');
    }
    const claimed = await this.prisma.employeeChangeRequest.updateMany({
      where: { id, status: EmployeeChangeStatus.PENDING },
      data: {
        status: approve
          ? EmployeeChangeStatus.APPROVED
          : EmployeeChangeStatus.REJECTED,
        decidedById: actor.id,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
      },
    });
    if (claimed.count !== 1) throw new BadRequestException('Already decided');
    if (approve) {
      const p = req.payload as Record<string, unknown>;
      try {
        if (req.kind === EmployeeChangeKind.TRANSFER) {
          await this.employees.transfer(req.employeeId, {
            currentBranchId: p.currentBranchId,
            currentDepartmentId: p.currentDepartmentId,
            currentDesignation: p.currentDesignation,
            changeType: (p.changeType as ChangeType) ?? ChangeType.TRANSFERRED,
            changeReason: p.changeReason,
            effectiveDate: p.effectiveDate,
            dutyStartTime: p.dutyStartTime,
            dutyEndTime: p.dutyEndTime,
            dutyTotalHours: p.dutyTotalHours,
          } as never);
        } else {
          await this.employees.updateBranchDuty(
            req.employeeId,
            {
              dutyStartTime: p.dutyStartTime as string,
              dutyEndTime: p.dutyEndTime as string,
              dutyTotalHours: p.dutyTotalHours as number,
            },
            actor.id,
          );
        }
      } catch (err) {
        // Nothing applied: put the request back so it can be fixed and approved again.
        await this.prisma.employeeChangeRequest.update({
          where: { id },
          data: {
            status: EmployeeChangeStatus.PENDING,
            decidedById: null,
            decidedAt: null,
            decisionNote: null,
          },
        });
        throw err;
      }
    }
    await this.prisma.notification.create({
      data: {
        employeeId: req.employeeId,
        type:
          req.kind === EmployeeChangeKind.TRANSFER
            ? 'TRANSFER'
            : 'WORKING_HOURS',
        message: approve
          ? `Approved: ${req.summary}`
          : `Not approved: ${req.summary}`,
      },
    });
    await this.audit(
      actor.id,
      approve ? 'EMPLOYEE_CHANGE_APPROVED' : 'EMPLOYEE_CHANGE_REJECTED',
      id,
      {
        employeeId: req.employeeId,
        kind: req.kind,
        summary: req.summary,
        note: note ?? null,
      },
    );
    return {
      id,
      status: approve
        ? EmployeeChangeStatus.APPROVED
        : EmployeeChangeStatus.REJECTED,
    };
  }

  private async assertNoOpen(employeeId: string, kind: EmployeeChangeKind) {
    const open = await this.prisma.employeeChangeRequest.findFirst({
      where: { employeeId, kind, status: EmployeeChangeStatus.PENDING },
    });
    if (open)
      throw new BadRequestException(
        'A request of this kind is already waiting for approval',
      );
  }

  private async create(
    employeeId: string,
    kind: EmployeeChangeKind,
    dto: object,
    summary: string,
    letter: unknown,
    actor: Actor,
  ) {
    const letterId =
      (letter as { letter?: { id?: string }; id?: string })?.letter?.id ??
      (letter as { id?: string })?.id ??
      null;
    const req = await this.prisma.employeeChangeRequest.create({
      data: {
        employeeId,
        kind,
        payload: dto as Prisma.InputJsonValue,
        summary,
        letterId,
        requestedById: actor.id,
      },
    });
    const approverRoles = APPROVERS[kind].filter(
      (r) => r !== UserRole.SUPER_ADMIN,
    );
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        employeeId: { not: null },
        OR: [
          { role: { in: approverRoles } },
          { additionalRoles: { some: { role: { in: approverRoles } } } },
        ],
      },
      select: { employeeId: true },
    });
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { fullName: true, employeeCode: true },
    });
    for (const u of users) {
      await this.prisma.notification.create({
        data: {
          employeeId: u.employeeId!,
          type: 'EMPLOYEE_CHANGE_PENDING',
          message: `${employee?.fullName} (${employee?.employeeCode ?? ''}): ${summary} — awaits your approval`,
        },
      });
    }
    await this.audit(actor.id, 'EMPLOYEE_CHANGE_REQUESTED', req.id, {
      employeeId,
      kind,
      summary,
      letterId,
    });
    return req;
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
        entity: 'EmployeeChangeRequest',
        entityId,
        changes,
      },
    });
  }
}

type JwtUser = { id: string; role: UserRole; roles?: UserRole[] };
const actorOf = (u: JwtUser): Actor => ({
  id: u.id,
  role: u.role,
  roles: u.roles?.length ? u.roles : [u.role],
});

@Controller('employee-change-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeeChangeRequestController {
  constructor(private service: EmployeeChangeRequestService) {}

  @Get()
  @Roles(
    ...CHANGE_REQUEST_HR_ROLES,
    UserRole.CHAIRMAN,
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
  )
  list(
    @Query('status') status?: EmployeeChangeStatus,
    @Query('employeeId') employeeId?: string,
    @Query('kind') kind?: EmployeeChangeKind,
  ) {
    return this.service.list({ status, employeeId, kind });
  }

  @Post('transfer')
  @Roles(...CHANGE_REQUEST_HR_ROLES)
  transfer(@Body() dto: TransferRequestDto, @CurrentUser() user: JwtUser) {
    return this.service.requestTransfer(dto, actorOf(user));
  }

  @Post('working-hours')
  @Roles(...CHANGE_REQUEST_HR_ROLES)
  workingHours(
    @Body() dto: WorkingHoursRequestDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.requestWorkingHours(dto, actorOf(user));
  }

  @Post(':id/approve')
  @Roles(
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.CHAIRMAN,
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.SUPER_ADMIN,
  )
  approve(
    @Param('id') id: string,
    @Body() dto: DecideDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.decide(id, true, dto.note, actorOf(user));
  }

  @Post(':id/reject')
  @Roles(
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.CHAIRMAN,
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.SUPER_ADMIN,
  )
  reject(
    @Param('id') id: string,
    @Body() dto: DecideDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.decide(id, false, dto.note, actorOf(user));
  }
}
