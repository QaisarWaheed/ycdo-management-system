import { Body, Controller, Get, Module, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Permission, UserRole } from '@prisma/client';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RoutePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AttendanceLockService } from './attendance-lock.service';

class MonthQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  year: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;
}

class VerifyMonthDto extends MonthQueryDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  branchIds: string[];
}

class UnlockMonthDto extends MonthQueryDto {
  @IsUUID()
  branchId: string;

  @IsString()
  @IsNotEmpty({ message: 'A reason is required to unlock attendance' })
  @MinLength(5, { message: 'Please give a reason of at least 5 characters' })
  reason: string;
}

@Controller('attendance-locks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceLockController {
  constructor(private locks: AttendanceLockService) {}

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.IT_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    UserRole.PAYROLL_OFFICER,
    UserRole.PRESIDENT,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
  )
  list(@Query() q: MonthQueryDto) {
    return this.locks.list(q.year, q.month);
  }

  /** HR verifies (locks) branch months for payroll. */
  @Post('verify')
  @RoutePermission(Permission.ATTENDANCE_VERIFY)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
  )
  verify(@Body() dto: VerifyMonthDto, @CurrentUser() user: { id: string }) {
    return this.locks.verify(dto.branchIds, dto.year, dto.month, user);
  }

  /** IT reopens a verified month (reason required). */
  @Post('unlock')
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  unlock(@Body() dto: UnlockMonthDto, @CurrentUser() user: { id: string }) {
    return this.locks.unlock(dto.branchId, dto.year, dto.month, dto.reason, user);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [AttendanceLockController],
  providers: [AttendanceLockService],
})
export class AttendanceLockModule {}
