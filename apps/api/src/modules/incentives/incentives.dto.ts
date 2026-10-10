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
  @IsString()
  @IsNotEmpty({ message: 'Write what this incentive is for — it is printed on the payslip' })
  @MaxLength(1000)
  reason: string;

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
