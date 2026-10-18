import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, StrictRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SPECIAL_LEAVE_HR_ROLES, SpecialLeaveService } from './special-leave.service';

class SpecialLeaveTypeDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @Type(() => Number) @IsIn([0, 50, 100]) payPercent: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxDays?: number | null;
}

class UpdateSpecialLeaveTypeDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @Type(() => Number) @IsIn([0, 50, 100]) payPercent?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxDays?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class ApplySpecialLeaveDto {
  @IsUUID() employeeId: string;
  @IsUUID() specialLeaveTypeId: string;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

class DecideSpecialLeaveDto {
  @IsBoolean() approve: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

type JwtUser = { id: string; role: UserRole; roles?: UserRole[]; employeeId?: string | null };
const actor = (u: JwtUser) => ({
  id: u.id,
  roles: u.roles?.length ? u.roles : [u.role],
  employeeId: u.employeeId,
});

const TYPE_MANAGERS = [UserRole.SUPER_ADMIN, UserRole.HR_OPERATIONS_MANAGER];
const DECIDERS = [UserRole.SUPER_ADMIN, UserRole.HR_OPERATIONS_MANAGER, UserRole.CHAIRMAN];

/** Phase 2 Req 2: special leaves — employee / HR apply, HR Operations → Chairman decide. */
@Controller('special-leave')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SpecialLeaveController {
  constructor(private service: SpecialLeaveService) {}

  @Get('types')
  listTypes(@Query('all') all?: string) {
    return this.service.listTypes(all === 'true');
  }

  @Post('types')
  @Roles(...TYPE_MANAGERS)
  @StrictRoles()
  createType(@Body() dto: SpecialLeaveTypeDto) {
    return this.service.createType(dto);
  }

  @Patch('types/:id')
  @Roles(...TYPE_MANAGERS)
  @StrictRoles()
  updateType(@Param('id') id: string, @Body() dto: UpdateSpecialLeaveTypeDto) {
    return this.service.updateType(id, dto);
  }

  /** Employee applies for self; HR roles for anyone (checked in the service). */
  @Post()
  @Roles(...SPECIAL_LEAVE_HR_ROLES, UserRole.EMPLOYEE)
  apply(@Body() dto: ApplySpecialLeaveDto, @CurrentUser() user: JwtUser) {
    return this.service.apply(dto, actor(user));
  }

  @Get('pending')
  @Roles(...DECIDERS)
  @StrictRoles()
  pending() {
    return this.service.find();
  }

  @Get('employee/:employeeId')
  @Roles(...SPECIAL_LEAVE_HR_ROLES, ...DECIDERS)
  history(@Param('employeeId') employeeId: string) {
    return this.service.find(employeeId);
  }

  @Get('mine')
  @Roles(UserRole.EMPLOYEE)
  mine(@CurrentUser() user: JwtUser) {
    return user.employeeId ? this.service.find(user.employeeId) : [];
  }

  @Patch(':id/decide')
  @Roles(...DECIDERS)
  @StrictRoles()
  decide(@Param('id') id: string, @Body() dto: DecideSpecialLeaveDto, @CurrentUser() user: JwtUser) {
    return this.service.decide(id, dto.approve, actor(user), dto.notes);
  }
}
