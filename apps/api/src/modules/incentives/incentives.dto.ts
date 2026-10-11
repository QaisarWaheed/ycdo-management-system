import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  IsEnum,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EmployeeApproverTarget } from '@prisma/client';

export class CreateIncentiveDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  amount: number;

  /** Incentive type from the list (On Progress, Private Room, ...). */
  @IsOptional()
  @IsUUID()
  typeId?: string;

  /** What it is for; printed on the payslip. */
  /** Extra note; optional when a type is chosen (the type is printed on the payslip). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

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

  /** Executive who approves it when the sender is not an executive. */
  @IsOptional()
  @IsEnum(EmployeeApproverTarget)
  approverTarget?: EmployeeApproverTarget;
}

/** Corrected values for an incentive (employee stays the same). */
export class UpdateIncentiveDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsUUID()
  typeId?: string;

  /** Extra note; optional when a type is chosen (the type is printed on the payslip). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2020)
  year: number;

  /** Needed when a non-executive raises the amount. */
  @IsOptional()
  @IsEnum(EmployeeApproverTarget)
  approverTarget?: EmployeeApproverTarget;
}

export class IncentiveQueryDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  year?: number;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export const incentiveAllowanceDescription = (reason: string) =>
  `Incentive: ${reason}`;

export const isIncentiveAllowance = (
  description: string | null | undefined,
  reason: string,
) => description === incentiveAllowanceDescription(reason);
