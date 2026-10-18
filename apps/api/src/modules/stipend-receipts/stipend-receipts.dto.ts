import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class GenerateStipendReceiptsDto {
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

export class RespondStipendDto {
  @IsUUID()
  @IsNotEmpty()
  receiptId: string;

  @IsBoolean()
  @IsNotEmpty()
  accept: boolean;

  @IsOptional()
  @IsString()
  rejectionReason?: string;

  /** Req 20.1: correction request — OVERTIME / EXTRA_DUTY / DEDUCTION / OTHER. */
  @IsOptional()
  @IsIn(['OVERTIME', 'EXTRA_DUTY', 'DEDUCTION', 'OTHER'])
  category?: string;

  /** Claimed dates, e.g. overtime: [{date: '2026-10-12', hours: 3}]. */
  @IsOptional()
  @IsArray()
  claimItems?: Array<{ date: string; hours?: number; note?: string }>;
}

export class StipendReceiptQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(2020)
  year?: number;
}
