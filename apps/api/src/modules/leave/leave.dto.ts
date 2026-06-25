import { LeaveStatus, LeaveType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ApplyLeaveDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsEnum(LeaveType)
  leaveType?: LeaveType;
}

export class UpdateLeaveStatusDto {
  @IsIn([LeaveStatus.APPROVED, LeaveStatus.REJECTED])
  status: LeaveStatus;

  @IsString()
  @IsNotEmpty()
  approvedBy: string;
}

export class LeaveQueryDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(LeaveStatus)
  status?: LeaveStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(12)
  month?: number;
}

export class RequestRelieverDto {
  @IsUUID()
  @IsNotEmpty()
  leaveRecordId: string;

  @IsUUID()
  @IsNotEmpty()
  relieverId: string;
}

export class RespondRelieverDto {
  @IsBoolean()
  @IsNotEmpty()
  accept: boolean;
}

export class HRAssignRelieverDto {
  @IsUUID()
  @IsNotEmpty()
  relieverId: string;
}
