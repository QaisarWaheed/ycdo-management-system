import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  OnboardingQueryDto,
  RejectOnboardingDto,
  ReviewOnboardingDto,
} from './employee-onboarding.dto';
import { EmployeeOnboardingService } from './employee-onboarding.service';

@Controller('employee-onboarding')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeeOnboardingController {
  constructor(private readonly service: EmployeeOnboardingService) {}

  @Get('pending')
  @Roles(
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.SUPER_ADMIN,
  )
  findPending(@CurrentUser() user: { id: string; role: UserRole }) {
    return this.service.findPending(user);
  }

  @Get()
  @Roles(
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
  )
  findAll(
    @Query() query: OnboardingQueryDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @Roles(
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
  )
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.service.findOne(id, user);
  }

  @Post(':id/approve')
  @Roles(
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.SUPER_ADMIN,
  )
  approve(
    @Param('id') id: string,
    @Body() dto: ReviewOnboardingDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.service.approve(id, user, dto.reviewNote);
  }

  @Post(':id/reject')
  @Roles(
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.SUPER_ADMIN,
  )
  reject(
    @Param('id') id: string,
    @Body() dto: RejectOnboardingDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.service.reject(id, user, dto.reviewNote);
  }
}
