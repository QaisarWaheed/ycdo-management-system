import { AllowanceType, DeductionType, PayrollStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreatePayrollEntryDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  @IsNotEmpty()
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @IsNotEmpty()
  year: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  basicSalary?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalAllowances?: number;
}

export class AddDeductionDto {
  @IsUUID()
  @IsNotEmpty()
  payrollEntryId: string;

  @IsEnum(DeductionType)
  @IsNotEmpty()
  reason: DeductionType;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class AddAllowanceDto {
  @IsUUID()
  @IsNotEmpty()
  payrollEntryId: string;

  @IsEnum(AllowanceType)
  @IsNotEmpty()
  type: AllowanceType;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  amount: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  hours?: number;
}

export class UpdatePayrollStatusDto {
  @IsEnum(PayrollStatus)
  @IsNotEmpty()
  status: PayrollStatus;
}

export class SalaryIncrementDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  newBasicSalary: number;

  @IsDateString()
  @IsNotEmpty()
  effectiveFrom: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class PayrollQueryDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @IsOptional()
  @IsEnum(PayrollStatus)
  status?: PayrollStatus;
}
