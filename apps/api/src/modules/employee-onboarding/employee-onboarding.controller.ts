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
  ForwardOnboardingDto,
  OnboardingQueryDto,
  RejectOnboardingDto,
  ReviewOnboardingDto,
  WhatsAppShareQueryDto,
} from './employee-onboarding.dto';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { physicalFormMulterConfig } from './physical-form.multer.config';
import { fileResponse } from '../../common/employee-files.util';
import {
  resolveUploadPath,
  safeFileName,
} from '../documents/documents.service';
import { NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

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

  @Get('whatsapp-share')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
    UserRole.HR_EXECUTIVE,
  )
  whatsappShare(@Query() query: WhatsAppShareQueryDto) {
    return this.service.buildWhatsAppShare(query);
  }

  @Get()
  @Roles(
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.SUPER_ADMIN,
    UserRole.IT_ADMIN,
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

  /** Scanned paper form; same readers as the onboarding record itself. */
  @Get(':id/physical-form')
  @Roles(
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
  )
  async physicalForm(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    const record = await this.service.findOne(id, user);
    if (!record.physicalFormUrl) {
      throw new NotFoundException('No physical form attached');
    }
    const fullPath = resolveUploadPath(record.physicalFormUrl);
    const name =
      record.physicalFormFileName ??
      `physical-form${path.extname(fullPath)}`;
    return fileResponse(fs.createReadStream(fullPath), safeFileName(name));
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

  /** IT re-routes a pending approval to President / Founder / Chairman. */
  @Post(':id/forward')
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  forward(
    @Param('id') id: string,
    @Body() dto: ForwardOnboardingDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.service.forward(id, user, dto.approverTarget, dto.reason);
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
