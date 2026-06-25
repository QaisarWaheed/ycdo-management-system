import { Type } from 'class-transformer';
import {
  IsBoolean,
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
