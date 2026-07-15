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
  CreatePreviousEmploymentDto,
  UpdatePreviousEmploymentDto,
} from './previous-employment.dto';
import { PreviousEmploymentService } from './previous-employment.service';

@Controller('previous-employment')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PreviousEmploymentController {
  constructor(
    private previousEmploymentService: PreviousEmploymentService,
    private permissionsService: PermissionsService,
  ) {}

  @Post()
  @Roles(...HR_PERSONAL_EDIT_ROLES)
  async create(
    @Body() dto: CreatePreviousEmploymentDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    const canEdit = await this.permissionsService.userHasPermission(
      user.id,
      user.role,
      Permission.EMPLOYEES_EDIT,
    );
    if (!canEdit) {
      throw new ForbiddenException(
        'You do not have permission to add previous employment',
      );
    }
    return this.previousEmploymentService.create(dto);
  }

  @Get(':employeeId')
  findAll(@Param('employeeId') employeeId: string) {
    return this.previousEmploymentService.findAll(employeeId);
  }

  @Patch(':id')
  @Roles(...HR_PERSONAL_EDIT_ROLES)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePreviousEmploymentDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    const canEdit = await this.permissionsService.userHasPermission(
      user.id,
      user.role,
      Permission.EMPLOYEES_EDIT,
    );
    if (!canEdit) {
      throw new ForbiddenException(
        'You do not have permission to edit previous employment',
      );
    }
    return this.previousEmploymentService.update(id, dto);
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
        'You do not have permission to delete previous employment',
      );
    }
    return this.previousEmploymentService.delete(id);
  }
}
