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
  CreateLocationValueDto,
  UpdateLocationValueDto,
} from './location-values.dto';
import { LocationValuesService } from './location-values.service';

const IT_ROLES = [UserRole.SUPER_ADMIN, UserRole.IT_ADMIN] as const;

@Controller('location-values')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LocationValuesController {
  constructor(private locationValuesService: LocationValuesService) {}

  @Get()
  findAll(@Query('type') type: string, @Query('search') search?: string) {
    return this.locationValuesService.findAll(type, search);
  }

  @Post()
  @Roles(...IT_ROLES)
  create(@Body() dto: CreateLocationValueDto) {
    return this.locationValuesService.create(
      dto.type,
      dto.value,
      dto.province,
      dto.city,
    );
  }

  @Patch(':id')
  @Roles(...IT_ROLES)
  update(@Param('id') id: string, @Body() dto: UpdateLocationValueDto) {
    return this.locationValuesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(...IT_ROLES)
  remove(@Param('id') id: string) {
    return this.locationValuesService.remove(id);
  }
}
