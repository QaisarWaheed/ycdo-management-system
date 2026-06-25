import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateIncentiveDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  amount: number;

  @IsString()
  @IsNotEmpty()
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
