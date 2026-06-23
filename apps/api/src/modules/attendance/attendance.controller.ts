import {
  Body,
  Controller,
  ForbiddenException,
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
import {
  AttendanceQueryDto,
  BiometricPushDto,
  ManualAttendanceDto,
  MarkAbsenteesDto,
} from './attendance.dto';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(
    private attendanceService: AttendanceService,
    private configService: ConfigService,
  ) {}

  @Post('biometric-push')
  biometricPush(
    @Headers('x-device-key') deviceKey: string,
    @Body() dto: BiometricPushDto,
  ) {
    const expectedKey = this.configService.get<string>('BIOMETRIC_DEVICE_KEY');
    if (!deviceKey || deviceKey !== expectedKey) {
      throw new UnauthorizedException('Invalid device key');
    }

    return this.attendanceService.biometricPush(dto);
  }

  @Post('manual')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.BRANCH_MANAGER)
  markManual(
    @Body() dto: ManualAttendanceDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.attendanceService.markManual(dto, user.id);
  }

  @Get('timer/:employeeId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE)
  getActiveTimer(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: { employeeId?: string | null },
  ) {
    if (user.employeeId !== employeeId) {
      throw new ForbiddenException('Access denied');
    }
    return this.attendanceService.getActiveTimer(employeeId);
  }

  @Get('reliever/:employeeId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.EMPLOYEE,
  )
  getRelieverSessions(
    @Param('employeeId') employeeId: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @CurrentUser() user: { role: UserRole; employeeId?: string | null },
  ) {
    if (
      user.role === UserRole.EMPLOYEE &&
      user.employeeId !== employeeId
    ) {
      throw new ForbiddenException('Access denied');
    }
    return this.attendanceService.getRelieverSessions(
      employeeId,
      Number(month),
      Number(year),
    );
  }

  @Get('summary/:employeeId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.EMPLOYEE,
  )
  getEmployeeSummary(
    @Param('employeeId') employeeId: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @CurrentUser() user: { role: UserRole; employeeId?: string | null },
  ) {
    if (
      user.role === UserRole.EMPLOYEE &&
      user.employeeId !== employeeId
    ) {
      throw new ForbiddenException('Access denied');
    }
    return this.attendanceService.getEmployeeSummary(
      employeeId,
      Number(month),
      Number(year),
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.EMPLOYEE,
  )
  findAll(
    @Query() query: AttendanceQueryDto,
    @CurrentUser() user: { role: UserRole; employeeId?: string | null },
  ) {
    if (user.role === UserRole.EMPLOYEE) {
      if (!user.employeeId) {
        throw new ForbiddenException('Employee profile required');
      }
      return this.attendanceService.findAll({
        ...query,
        employeeId: user.employeeId,
      });
    }
    return this.attendanceService.findAll(query);
  }

  @Post('mark-absentees')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  markAbsentees(@Body() dto: MarkAbsenteesDto) {
    return this.attendanceService.markAbsentees(dto.date);
  }
}
