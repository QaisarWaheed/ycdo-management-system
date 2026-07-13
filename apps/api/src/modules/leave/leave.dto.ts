import { LeaveApprovalAction, LeaveStatus, LeaveType, UserRole } from '@prisma/client';
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
  MinLength,
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

export class ApproveLeaveDto {
  @IsEnum(LeaveApprovalAction)
  @IsNotEmpty()
  action: LeaveApprovalAction;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
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

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  currentStage?: string;

  @IsOptional()
  @IsEnum(UserRole)
  pendingForRole?: UserRole;
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

export class EmergencyLeaveDto {
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
  @MinLength(10)
  emergencyReason: string;
}

/** Leave marked from Manual Attendance — immediately APPROVED, no workflow. */
export class VerifiedLeaveDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @IsEnum(LeaveType)
  leaveType: LeaveType;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
