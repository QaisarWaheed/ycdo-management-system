import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { assertCanEditPersonalInfo } from '../../common/hr-executive.util';
import {
  CreateQualificationDto,
  UpdateQualificationDto,
} from './qualifications.dto';
import { QualificationsService } from './qualifications.service';

@Controller('qualifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QualificationsController {
  constructor(private qualificationsService: QualificationsService) {}

  @Post()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.IT_ADMIN,
  )
  create(
    @Body() dto: CreateQualificationDto,
    @CurrentUser() user: { role: UserRole },
  ) {
    assertCanEditPersonalInfo(user.role);
    return this.qualificationsService.create(dto);
  }

  @Get(':employeeId')
  findAll(@Param('employeeId') employeeId: string) {
    return this.qualificationsService.findAll(employeeId);
  }

  @Patch(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.IT_ADMIN,
  )
  update(
    @Param('id') id: string,
    @Body() dto: UpdateQualificationDto,
    @CurrentUser() user: { role: UserRole },
  ) {
    assertCanEditPersonalInfo(user.role);
    return this.qualificationsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.IT_ADMIN,
  )
  delete(
    @Param('id') id: string,
    @CurrentUser() user: { role: UserRole },
  ) {
    assertCanEditPersonalInfo(user.role);
    return this.qualificationsService.delete(id);
  }
}
