import { AttendanceLogType, AttendanceStatus, AttendanceSource, EmployeeStatus, Gender, ProjectType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
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

  @IsOptional()
  @IsIn(['CHECKIN', 'CHECKOUT', 'OVERTIME_CHECKIN'])
  punchType?: 'CHECKIN' | 'CHECKOUT' | 'OVERTIME_CHECKIN';
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
  checkIn?: string | null;

  @IsOptional()
  @IsDateString()
  checkOut?: string | null;

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
  @IsString()
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
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsEnum(ProjectType)
  project?: ProjectType;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsString()
  shiftIds?: string;

  @IsOptional()
  @IsString()
  shiftName?: string;

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

  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class MarkAbsenteesDto {
  @IsDateString()
  @IsNotEmpty()
  date: string;
}

export class BackfillAbsentDto {
  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsOptional()
  @IsString()
  shiftName?: string;
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

export class ImportAttendanceDto {
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

  @IsEnum(AttendanceSource)
  @IsNotEmpty()
  source: AttendanceSource;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsEnum(AttendanceLogType)
  type?: AttendanceLogType;
}

export class RelieverSessionsQueryDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsString()
  shiftIds?: string;

  @IsOptional()
  @IsString()
  shiftName?: string;

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
