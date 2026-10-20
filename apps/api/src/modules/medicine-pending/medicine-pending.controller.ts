import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MedicinePendingService } from './medicine-pending.service';

/** Finance keeps the daily log; executives and IT can read it. */
const WRITE_ROLES = [UserRole.PAYROLL_OFFICER, UserRole.SUPER_ADMIN];
const READ_ROLES = [
  ...WRITE_ROLES,
  UserRole.FOUNDER,
  UserRole.CHAIRMAN,
  UserRole.PRESIDENT,
  UserRole.IT_ADMIN,
];

class CreateMedicinePendingDto {
  @IsUUID() employeeId: string;
  @IsString() @MinLength(1) @MaxLength(50) tokenNo: string;
  @Type(() => Number) @IsNumber() @IsPositive() amount: number;
  @IsDateString() pendingDate: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

@Controller('medicine-pending')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MedicinePendingController {
  constructor(private service: MedicinePendingService) {}

  @Get()
  @Roles(...READ_ROLES)
  list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.service.list({ from, to, employeeId });
  }

  @Post()
  @Roles(...WRITE_ROLES)
  create(@Body() dto: CreateMedicinePendingDto, @CurrentUser() user: { id: string }) {
    return this.service.create(dto, user.id);
  }

  @Delete(':id')
  @Roles(...WRITE_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.service.remove(id, user.id);
  }
}
