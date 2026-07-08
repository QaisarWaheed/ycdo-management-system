import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateLocationValueDto } from './location-values.dto';
import { LocationValuesService } from './location-values.service';

@Controller('location-values')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LocationValuesController {
  constructor(private locationValuesService: LocationValuesService) {}

  @Get()
  findAll(@Query('type') type: string, @Query('search') search?: string) {
    return this.locationValuesService.findAll(type, search);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  create(@Body() dto: CreateLocationValueDto) {
    return this.locationValuesService.create(
      dto.type,
      dto.value,
      dto.province,
      dto.city,
    );
  }
}
