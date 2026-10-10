import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AllowanceProration, EmployeeApproverTarget } from '@prisma/client';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_MSG = 'Use a month like 2026-11';

export class CreateAllowanceTypeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsEnum(AllowanceProration)
  proration?: AllowanceProration;
}

export class UpdateAllowanceTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsEnum(AllowanceProration)
  proration?: AllowanceProration;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateIncentiveTypeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;
}

export class UpdateIncentiveTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Set (add or change) one allowance on an employee's package. */
export class AssignAllowanceDto {
  @IsUUID()
  employeeId: string;

  @IsUUID()
  typeId: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount: number;

  /** First month it applies, YYYY-MM. */
  @Matches(MONTH, { message: MONTH_MSG })
  startMonth: string;

  /** Last month it applies (temporary allowance), YYYY-MM. */
  @IsOptional()
  @Matches(MONTH, { message: MONTH_MSG })
  endMonth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Who approves it when the sender is not an executive. */
  @IsOptional()
  @IsEnum(EmployeeApproverTarget)
  approverTarget?: EmployeeApproverTarget;
}

export class EndAllowanceDto {
  /** Last month it applies, YYYY-MM. */
  @Matches(MONTH, { message: MONTH_MSG })
  @IsNotEmpty()
  endMonth: string;
}
