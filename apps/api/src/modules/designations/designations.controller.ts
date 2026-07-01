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
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateDesignationDto,
  DesignationQueryDto,
  UpdateDesignationDto,
} from './designations.dto';
import { DesignationsService } from './designations.service';

const IT_ADMIN_ROLES = [UserRole.SUPER_ADMIN, UserRole.IT_ADMIN];

@Controller('designations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DesignationsController {
  constructor(private designationsService: DesignationsService) {}

  @Get()
  findAll(@Query() query: DesignationQueryDto) {
    return this.designationsService.findAll(query);
  }

  @Post()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.IT_ADMIN,
  )
  create(@Body() dto: CreateDesignationDto) {
    return this.designationsService.create(dto);
  }

  @Patch(':id')
  @Roles(...IT_ADMIN_ROLES)
  update(@Param('id') id: string, @Body() dto: UpdateDesignationDto) {
    return this.designationsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(...IT_ADMIN_ROLES)
  deactivate(@Param('id') id: string) {
    return this.designationsService.deactivate(id);
  }
}
