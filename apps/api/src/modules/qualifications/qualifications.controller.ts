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
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
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
  )
  create(@Body() dto: CreateQualificationDto) {
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
  )
  update(@Param('id') id: string, @Body() dto: UpdateQualificationDto) {
    return this.qualificationsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
  )
  delete(@Param('id') id: string) {
    return this.qualificationsService.delete(id);
  }
}
