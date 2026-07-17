import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReportResultDto } from './face-sync.dto';
import { FaceSyncService } from './face-sync.service';

@Controller('face-sync')
export class FaceSyncController {
  constructor(
    private faceSyncService: FaceSyncService,
    private configService: ConfigService,
  ) {}

  private verifyDeviceKey(deviceKey: string | undefined) {
    const expectedKey = this.configService.get<string>('BIOMETRIC_DEVICE_KEY');
    if (!deviceKey || deviceKey !== expectedKey) {
      throw new UnauthorizedException('Invalid device key');
    }
  }

  @Get('pending')
  getPending(
    @Headers('x-device-key') deviceKey: string,
    @Query('deviceId') deviceId: string,
  ) {
    this.verifyDeviceKey(deviceKey);
    return this.faceSyncService.getPendingJobs(deviceId);
  }

  @Post('result')
  reportResult(
    @Headers('x-device-key') deviceKey: string,
    @Body() dto: ReportResultDto,
  ) {
    this.verifyDeviceKey(deviceKey);
    return this.faceSyncService.reportResult(dto);
  }

  @Post('sync-all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  syncAll(@CurrentUser() user: { id: string }) {
    return this.faceSyncService.syncAllEmployees(user.id);
  }

  @Post('employee/:employeeId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.IT_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR_ADMIN_MANAGER,
  )
  syncEmployee(@Param('employeeId') employeeId: string) {
    return this.faceSyncService.createSyncJobForEmployee(employeeId);
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.IT_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.MEDICINE_MANAGER,
    UserRole.DEPARTMENT_HEAD,
  )
  getStats(@Query('employeeId') employeeId?: string) {
    return this.faceSyncService.getStats(employeeId);
  }

  @Get('registration/:employeeId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.IT_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.MEDICINE_MANAGER,
    UserRole.DEPARTMENT_HEAD,
  )
  getRegistration(@Param('employeeId') employeeId: string) {
    return this.faceSyncService.getBiometricRegistrationSummary(employeeId);
  }

  @Get('jobs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  listJobs() {
    return this.faceSyncService.listJobs();
  }

  @Get('sync-all/preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  syncAllPreview() {
    return this.faceSyncService.countEmployeesWithPhotos();
  }
}
