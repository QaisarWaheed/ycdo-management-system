import { AttendanceStatus, EmployeeStatus, Gender } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class BiometricPushDto {
  @IsString()
  @IsNotEmpty()
  biometricId: string;

  @IsDateString()
  @IsNotEmpty()
  timestamp: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class ManualAttendanceDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @IsEnum(AttendanceStatus)
  @IsNotEmpty()
  status: AttendanceStatus;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lateMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overtimeMinutes?: number;
}

export class ApproveOvertimeDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overtimeMinutes: number;
}

export class AttendanceQueryDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  year?: number;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsString()
  shiftIds?: string;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  employeeStatus?: EmployeeStatus;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  district?: string;
}

export class MarkAbsenteesDto {
  @IsDateString()
  @IsNotEmpty()
  date: string;
}

export class PortalCheckDto {
  @Type(() => Number)
  @IsNumber()
  latitude: number;

  @Type(() => Number)
  @IsNumber()
  longitude: number;
}

export class UpdateAttendanceDto {
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lateMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overtimeMinutes?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class RelieverSessionsQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsString()
  shiftIds?: string;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  employeeStatus?: EmployeeStatus;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  district?: string;
}
