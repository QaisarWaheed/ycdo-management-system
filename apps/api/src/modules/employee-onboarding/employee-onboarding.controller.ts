import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { physicalFormMulterConfig } from './physical-form.multer.config';

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

  @Post('employee/:employeeId/physical-form')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
    UserRole.HR_EXECUTIVE,
  )
  @UseInterceptors(FileInterceptor('file', physicalFormMulterConfig))
  uploadPhysicalForm(
    @Param('employeeId') employeeId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.service.uploadPhysicalForm(employeeId, file, user);
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
