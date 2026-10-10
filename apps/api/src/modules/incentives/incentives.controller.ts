import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Permission, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, RoutePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateIncentiveDto, IncentiveQueryDto } from './incentives.dto';
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

  @Post()
  @RoutePermission(Permission.INCENTIVES_MANAGE)
  @Roles(
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.PAYROLL_OFFICER,
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
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

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN_MANAGER)
  delete(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.incentivesService.delete(id, user.id);
  }
}
