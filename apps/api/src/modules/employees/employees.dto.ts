import { PartialType } from '@nestjs/mapped-types';
import { ChangeType, EmployeeStatus, Gender } from '@prisma/client';
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

  @IsOptional()
  @IsString()
  fatherName?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'CNIC format: 12345-1234567-1',
  })
  cnic: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsOptional()
  @IsString()
  address?: string;

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
  @IsString()
  fatherContactNumber?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactNumber?: string;

  @IsOptional()
  @IsString()
  spouseName?: string;

  @IsOptional()
  @IsString()
  spouseContactNumber?: string;

  @IsOptional()
  @IsString()
  caste?: string;

  @IsOptional()
  @IsString()
  domicile?: string;

  @IsOptional()
  @IsString()
  currentAddress?: string;

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

  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  basicStipend: number;
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
}
