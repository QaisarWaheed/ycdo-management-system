import { PartialType } from '@nestjs/mapped-types';
import {
  ChangeType,
  EmployeeStatus,
  Gender,
  MaritalStatus,
  ProjectType,
  StaffType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsNotEmpty()
  fatherName: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'CNIC format: 12345-1234567-1',
  })
  cnic?: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsDateString()
  @IsNotEmpty()
  dateOfBirth: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsString()
  @IsNotEmpty()
  currentAddress: string;

  @IsDateString()
  @IsNotEmpty()
  joiningDate: string;

  @IsUUID()
  @IsNotEmpty()
  currentBranchId: string;

  @IsUUID()
  @IsNotEmpty()
  currentDepartmentId: string;

  @IsString()
  @IsNotEmpty()
  currentDesignation: string;

  @IsOptional()
  @IsString()
  biometricId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsIn(['Morning', 'Evening', 'Night', '24 Hours'])
  shiftName?: string;

  @IsOptional()
  @IsString()
  fatherContactNumber?: string;

  @IsOptional()
  @IsIn(['ALIVE', 'DECEASED'])
  fatherStatus?: string;

  @IsOptional()
  @IsString()
  guardianContact?: string;

  @IsString()
  @IsNotEmpty()
  emergencyContactName: string;

  @IsOptional()
  @IsString()
  emergencyRelation?: string;

  @IsString()
  @IsNotEmpty()
  emergencyContactNumber: string;

  @IsOptional()
  @IsString()
  spouseName?: string;

  @IsOptional()
  @IsString()
  spouseContactNumber?: string;

  @IsOptional()
  @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus;

  @IsOptional()
  @IsString()
  caste?: string;

  @IsOptional()
  @IsString()
  domicile?: string;

  @IsOptional()
  @IsString()
  permanentAddress?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  tehsil?: string;

  @IsOptional()
  @IsString()
  policeStation?: string;

  @IsString()
  @IsNotEmpty()
  bloodGroup: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  basicStipend: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  allowances?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  reward?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  progressReward?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fuelAllowance?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  loanDeduction?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  advanceDeduction?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fineDeduction?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  healthDeduction?: number;

  @IsOptional()
  @IsEnum(StaffType)
  staffType?: StaffType;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  dutyStartTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  dutyEndTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  dutyTotalHours?: number;

  @IsString()
  @IsNotEmpty()
  province: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsOptional()
  @IsString()
  permanentProvince?: string;

  @IsOptional()
  @IsString()
  permanentCity?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ADMIN_MANAGER'])
  userRole?: string;
}

export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}

export class ChangeStatusDto {
  @IsEnum(EmployeeStatus)
  @IsNotEmpty()
  status: EmployeeStatus;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class TransferDto {
  @IsUUID()
  @IsNotEmpty()
  currentBranchId: string;

  @IsUUID()
  @IsNotEmpty()
  currentDepartmentId: string;

  @IsString()
  @IsNotEmpty()
  currentDesignation: string;

  @IsIn([ChangeType.TRANSFERRED, ChangeType.PROMOTED, ChangeType.DEMOTED])
  changeType: ChangeType;

  @IsString()
  @IsNotEmpty()
  changeReason: string;

  @IsDateString()
  @IsNotEmpty()
  effectiveDate: string;
}

export class EmployeeQueryDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsEnum(ProjectType)
  project?: ProjectType;

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
  status?: EmployeeStatus;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus;

  @IsOptional()
  @IsBooleanString()
  widowOnly?: string;

  @IsOptional()
  @IsBooleanString()
  unassigned?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @IsOptional()
  @IsDateString()
  joinedFrom?: string;

  @IsOptional()
  @IsDateString()
  joinedTo?: string;

  @IsOptional()
  @IsBooleanString()
  count?: string;
}

export class UpdateBranchDutyDto {
  @IsOptional()
  @IsUUID()
  currentBranchId?: string;

  @IsOptional()
  @IsUUID()
  currentDepartmentId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  dutyStartTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  dutyEndTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  dutyTotalHours?: number;
}

export class ActiveShiftQueryDto {
  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  time: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;
}
