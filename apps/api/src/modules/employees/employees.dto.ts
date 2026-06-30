import { PartialType } from '@nestjs/mapped-types';
import { ChangeType, EmployeeStatus, Gender, StaffType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsNotEmpty()
  fatherName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'CNIC format: 12345-1234567-1',
  })
  cnic: string;

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
  @IsIn(['Day', 'Night', '24 Hours'])
  shiftName?: string;

  @IsString()
  @IsNotEmpty()
  fatherContactNumber: string;

  @IsString()
  @IsNotEmpty()
  emergencyContactName: string;

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
  @IsString()
  caste?: string;

  @IsString()
  @IsNotEmpty()
  domicile: string;

  @IsString()
  @IsNotEmpty()
  permanentAddress: string;

  @IsString()
  @IsNotEmpty()
  district: string;

  @IsString()
  @IsNotEmpty()
  tehsil: string;

  @IsString()
  @IsNotEmpty()
  policeStation: string;

  @IsString()
  @IsNotEmpty()
  bloodGroup: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  basicStipend: number;

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
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

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
  search?: string;

  @IsOptional()
  @IsDateString()
  joinedFrom?: string;

  @IsOptional()
  @IsDateString()
  joinedTo?: string;
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
}
