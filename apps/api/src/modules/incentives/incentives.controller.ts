import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Permission, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, RoutePermission, StrictRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateIncentiveDto,
  IncentiveQueryDto,
  StopIncentivePlanDto,
  UpdateIncentiveDto,
  UpdateIncentivePlanDto,
} from './incentives.dto';
import { PayChangeKind } from '@prisma/client';
import {
  isPayExecutive,
  PayChangeRequestsService,
  type PayActor,
} from '../pay-approvals/pay-change-requests.service';
import { IncentivesService } from './incentives.service';

@Controller('incentives')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IncentivesController {
  constructor(
    private incentivesService: IncentivesService,
    private payChangeRequests: PayChangeRequestsService,
  ) {}

  /** Only executives set incentives (Founder decision); Finance can view. */
  @Post()
  @StrictRoles()
  @Roles(
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.SUPER_ADMIN,
  )
  async create(
    @Body() dto: CreateIncentiveDto,
    @CurrentUser() user: PayActor & { role: UserRole },
  ) {
    // Incentives always raise pay: executives add them, everyone else asks.
    if (!isPayExecutive(user)) {
      return this.payChangeRequests.submit(
        {
          kind: PayChangeKind.INCENTIVE,
          employeeId: dto.employeeId,
          payload: { ...dto },
          summary: await this.payChangeRequests.describeIncentive(dto),
          reason: dto.reason,
          approverTarget: dto.approverTarget,
        },
        user,
      );
    }
    return this.incentivesService.create(dto, user.id, user.role);
  }

  @Get()
  @RoutePermission(Permission.INCENTIVES_VIEW)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.PRESIDENT,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
    UserRole.PAYROLL_OFFICER,
  )
  findAll(
    @Query() query: IncentiveQueryDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.incentivesService.findAll(query, user);
  }

  /** Graphs: last 12 months' totals and this month by branch. */
  @Get('stats')
  @StrictRoles()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.PRESIDENT,
    UserRole.PAYROLL_OFFICER,
  )
  stats(
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    return this.incentivesService.stats(year, month);
  }

  /** Point 21: recurring incentives (one employee, or all in scope). */
  @Get('plans')
  @RoutePermission(Permission.INCENTIVES_VIEW)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.PRESIDENT,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
    UserRole.PAYROLL_OFFICER,
  )
  findPlans(
    @Query('employeeId') employeeId: string | undefined,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.incentivesService.findPlans(employeeId || undefined, user);
  }

  /** Point 21: change amount / last month for the months not yet in payroll. */
  @Patch('plans/:id')
  @StrictRoles()
  @Roles(
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.SUPER_ADMIN,
  )
  updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdateIncentivePlanDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.incentivesService.updatePlan(id, dto, user.id);
  }

  /** Point 21: stop a recurring incentive after lastMonth/lastYear. */
  @Post('plans/:id/stop')
  @StrictRoles()
  @Roles(
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.SUPER_ADMIN,
  )
  stopPlan(
    @Param('id') id: string,
    @Body() dto: StopIncentivePlanDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.incentivesService.stopPlan(id, dto, user.id);
  }

  @Get('employee/:employeeId')
  @RoutePermission(Permission.INCENTIVES_VIEW)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.PRESIDENT,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
    UserRole.IT_ADMIN,
    UserRole.PAYROLL_OFFICER,
    UserRole.EMPLOYEE,
  )
  findByEmployee(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: { role: UserRole; employeeId?: string | null },
  ) {
    // Portal: an employee may read only their own incentives.
    if (user.role === UserRole.EMPLOYEE && user.employeeId !== employeeId) {
      throw new ForbiddenException('You can only view your own incentives');
    }
    return this.incentivesService.findByEmployee(employeeId);
  }

  /**
   * Fix a wrong incentive while its month is Pending. Lowering it or
   * changing type / note / month applies at once; raising the amount goes
   * to an executive like a new incentive (executives apply directly).
   */
  @Patch(':id')
  @StrictRoles()
  @Roles(
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.SUPER_ADMIN,
  )
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateIncentiveDto,
    @CurrentUser() user: PayActor & { role: UserRole },
  ) {
    const current = await this.incentivesService.findOne(id);
    if (!isPayExecutive(user) && dto.amount > Number(current.amount)) {
      const { approverTarget, ...values } = dto;
      return this.payChangeRequests.submit(
        {
          kind: PayChangeKind.INCENTIVE,
          employeeId: current.employeeId,
          payload: { incentiveId: id, ...values },
          summary: await this.payChangeRequests.describeIncentiveChange(
            current,
            dto,
          ),
          reason: dto.reason,
          approverTarget,
        },
        user,
      );
    }
    return this.incentivesService.update(id, dto, user.id, isSuperAdmin(user));
  }

  @Delete(':id')
  @StrictRoles()
  @Roles(
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.SUPER_ADMIN,
  )
  delete(
    @Param('id') id: string,
    @CurrentUser() user: PayActor & { role: UserRole },
  ) {
    return this.incentivesService.delete(id, user.id, isSuperAdmin(user));
  }
}

/** Super Admin may fix an incentive even after its month is Processed / Paid. */
function isSuperAdmin(user: PayActor) {
  const roles = user.roles?.length ? user.roles : [user.role];
  return roles.includes(UserRole.SUPER_ADMIN);
}
