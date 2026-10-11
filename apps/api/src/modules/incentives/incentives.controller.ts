import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
  UpdateIncentiveDto,
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

  /** Finance (and executives) only; HR cannot add pay. */
  @Post()
  @StrictRoles()
  @Roles(
    UserRole.PAYROLL_OFFICER,
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
    UserRole.EMPLOYEE,
  )
  findByEmployee(@Param('employeeId') employeeId: string) {
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
    UserRole.PAYROLL_OFFICER,
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
          summary: await this.payChangeRequests.describeIncentiveChange(current, dto),
          reason: dto.reason,
          approverTarget,
        },
        user,
      );
    }
    return this.incentivesService.update(id, dto, user.id);
  }

  @Delete(':id')
  @StrictRoles()
  @Roles(
    UserRole.PAYROLL_OFFICER,
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.SUPER_ADMIN,
  )
  delete(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.incentivesService.delete(id, user.id);
  }
}
