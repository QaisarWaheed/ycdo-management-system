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
  CreateBiometricDeviceDto,
  UpdateBiometricDeviceDto,
} from './biometric-devices.dto';
import { BiometricDevicesService } from './biometric-devices.service';

@Controller('biometric-devices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BiometricDevicesController {
  constructor(private biometricDevicesService: BiometricDevicesService) {}

  @Get()
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  findAll() {
    return this.biometricDevicesService.findAll();
  }

  @Post()
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  create(@Body() dto: CreateBiometricDeviceDto) {
    return this.biometricDevicesService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateBiometricDeviceDto) {
    return this.biometricDevicesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  remove(@Param('id') id: string) {
    return this.biometricDevicesService.remove(id);
  }
}
