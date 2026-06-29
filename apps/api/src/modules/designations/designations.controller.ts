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
  CreateDesignationDto,
  UpdateDesignationDto,
} from './designations.dto';
import { DesignationsService } from './designations.service';

@Controller('designations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DesignationsController {
  constructor(private designationsService: DesignationsService) {}

  @Get()
  findAll() {
    return this.designationsService.findAll();
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  create(@Body() dto: CreateDesignationDto) {
    return this.designationsService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateDesignationDto) {
    return this.designationsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  deactivate(@Param('id') id: string) {
    return this.designationsService.deactivate(id);
  }
}
