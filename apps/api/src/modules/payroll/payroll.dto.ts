import { AllowanceType, DeductionType, PayrollStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
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
  ValidateIf,
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
  basicStipend?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalAllowances?: number;

  /** Allow create/refresh when employee is not ACTIVE or ON_REST (e.g. approved suspended). */
  @IsOptional()
  @IsBoolean()
  allowNonActive?: boolean;

  @ValidateIf((o: CreatePayrollEntryDto) => o.allowNonActive === true)
  @IsString()
  @IsNotEmpty()
  approvalReason?: string;
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

export class ApplyOvertimeDto {
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
}

export class RecomputeMonthAllDto {
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
  @IsBoolean()
  dryRun?: boolean;

  /** Required, and must equal exactly 'RECOMPUTE_PENDING_PAYROLL', for any
   * request where dryRun is not true — see PayrollService.recomputeMonthAll. */
  @ValidateIf((o: RecomputeMonthAllDto) => o.dryRun !== true)
  @Equals('RECOMPUTE_PENDING_PAYROLL')
  confirm?: string;

  /** Unique-employee batch size (not PayrollEntry row count). Defaults to
   * 25 when omitted; capped at 50 to keep each call comfortably clear of
   * a 504 timeout. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** Unique-employee offset into the deterministically-sorted employee
   * list for this month/year — page through a large month via repeated
   * calls using the previous response's nextOffset. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ResetUnpaidPayrollDto {
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
  @IsUUID()
  branchId?: string;

  /** When true, clears unpaid payroll in every month, not only month/year. */
  @IsOptional()
  @IsBoolean()
  allUnpaidMonths?: boolean;

  @Equals('RESET_UNPAID_PAYROLL')
  confirm: 'RESET_UNPAID_PAYROLL';
}

export class RebuildPayrollDto {
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
  @IsUUID()
  branchId?: string;

  @Equals('REBUILD_PAYROLL')
  confirm: 'REBUILD_PAYROLL';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
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
