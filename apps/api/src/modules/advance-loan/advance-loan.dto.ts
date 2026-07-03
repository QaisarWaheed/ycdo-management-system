import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAdvanceLoanDto {
  @IsIn(['ADVANCE', 'LOAN'])
  @IsNotEmpty()
  type: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @MinLength(20)
  reason: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  repaymentMonths?: number;
}

export class RejectAdvanceLoanDto {
  @IsString()
  @IsNotEmpty()
  rejectionReason: string;
}

export class AdvanceLoanQueryDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsIn(['ADVANCE', 'LOAN'])
  type?: string;

  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: string;
}
