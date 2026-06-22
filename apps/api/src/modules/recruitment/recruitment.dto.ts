import { ApplicationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
} from 'class-validator';

export class SubmitApplicationDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'CNIC format: 12345-1234567-1',
  })
  cnic?: string;

  @IsString()
  @IsNotEmpty()
  position: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUrl()
  resumeUrl?: string;
}

export class UpdateApplicationStatusDto {
  @IsEnum(ApplicationStatus)
  @IsNotEmpty()
  status: ApplicationStatus;

  @IsOptional()
  @IsDateString()
  interviewDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ApplicationQueryDto {
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class AcceptCandidateDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  selectedSalary: number;

  @IsUUID()
  @IsNotEmpty()
  selectedDeptId: string;

  @IsUUID()
  @IsNotEmpty()
  selectedBranchId: string;

  @IsString()
  @IsNotEmpty()
  selectedDesignation: string;

  @IsOptional()
  @IsString()
  interviewNotes?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;
}
