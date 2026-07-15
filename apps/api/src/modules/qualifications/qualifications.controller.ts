import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Permission, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { HR_PERSONAL_EDIT_ROLES } from '../../common/hr-executive.util';
import { PermissionsService } from '../permissions/permissions.service';
import {
  CreateQualificationDto,
  UpdateQualificationDto,
} from './qualifications.dto';
import { QualificationsService } from './qualifications.service';

@Controller('qualifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QualificationsController {
  constructor(
    private qualificationsService: QualificationsService,
    private permissionsService: PermissionsService,
  ) {}

  @Post()
  @Roles(...HR_PERSONAL_EDIT_ROLES)
  async create(
    @Body() dto: CreateQualificationDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    const canEdit = await this.permissionsService.userHasPermission(
      user.id,
      user.role,
      Permission.EMPLOYEES_EDIT,
    );
    if (!canEdit) {
      throw new ForbiddenException(
        'You do not have permission to add qualifications',
      );
    }
    return this.qualificationsService.create(dto);
  }

  @Get(':employeeId')
  findAll(@Param('employeeId') employeeId: string) {
    return this.qualificationsService.findAll(employeeId);
  }

  @Patch(':id')
  @Roles(...HR_PERSONAL_EDIT_ROLES)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateQualificationDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    const canEdit = await this.permissionsService.userHasPermission(
      user.id,
      user.role,
      Permission.EMPLOYEES_EDIT,
    );
    if (!canEdit) {
      throw new ForbiddenException(
        'You do not have permission to edit qualifications',
      );
    }
    return this.qualificationsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(...HR_PERSONAL_EDIT_ROLES)
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    const canEdit = await this.permissionsService.userHasPermission(
      user.id,
      user.role,
      Permission.EMPLOYEES_EDIT,
    );
    if (!canEdit) {
      throw new ForbiddenException(
        'You do not have permission to delete qualifications',
      );
    }
    return this.qualificationsService.delete(id);
  }
}
