import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { EmployeeApproverTarget, PayChangeStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PayApprovalsService } from './pay-approvals.service';
import {
  PayChangeRequestsService,
  type PayActor,
} from './pay-change-requests.service';

class PayApprovalQueryDto {
  @IsOptional()
  @IsEnum(PayChangeStatus)
  status?: PayChangeStatus;

  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

class ApprovePayChangeDto {
  @IsOptional()
  @IsString()
  reviewNote?: string;
}

class RejectPayChangeDto {
  @IsString()
  @IsNotEmpty({ message: 'A reason is required to reject this request' })
  @MinLength(5, { message: 'Please give a reason of at least 5 characters' })
  reviewNote: string;
}

class ForwardPayChangeDto {
  @IsEnum(EmployeeApproverTarget)
  approverTarget: EmployeeApproverTarget;

  @IsString()
  @IsNotEmpty({ message: 'A reason is required to forward this request' })
  @MinLength(5, { message: 'Please give a reason of at least 5 characters' })
  reason: string;
}

const DECIDE_ROLES = [
  UserRole.PRESIDENT,
  UserRole.FOUNDER,
  UserRole.CHAIRMAN,
  UserRole.SUPER_ADMIN,
];

@Controller('pay-approvals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayApprovalsController {
  constructor(
    private requests: PayChangeRequestsService,
    private approvals: PayApprovalsService,
  ) {}

  @Get()
  @Roles(
    ...DECIDE_ROLES,
    UserRole.IT_ADMIN,
    UserRole.PAYROLL_OFFICER,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
  )
  list(@Query() query: PayApprovalQueryDto, @CurrentUser() user: PayActor) {
    return this.requests.list(query, user);
  }

  @Post(':id/approve')
  @Roles(...DECIDE_ROLES)
  approve(
    @Param('id') id: string,
    @Body() dto: ApprovePayChangeDto,
    @CurrentUser() user: PayActor,
  ) {
    return this.approvals.approve(id, user, dto.reviewNote);
  }

  @Post(':id/reject')
  @Roles(...DECIDE_ROLES)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectPayChangeDto,
    @CurrentUser() user: PayActor,
  ) {
    return this.requests.reject(id, user, dto.reviewNote);
  }

  /** IT re-routes a pending request to another executive. */
  @Post(':id/forward')
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  forward(
    @Param('id') id: string,
    @Body() dto: ForwardPayChangeDto,
    @CurrentUser() user: PayActor,
  ) {
    return this.requests.forward(id, user, dto.approverTarget, dto.reason);
  }
}
