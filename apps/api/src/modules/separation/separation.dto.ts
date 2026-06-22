import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class ResignationDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsDateString()
  @IsNotEmpty()
  resignationDate: string;

  @IsDateString()
  @IsNotEmpty()
  lastWorkingDate: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class PromotionDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  newDesignation: string;

  @IsOptional()
  @IsUUID()
  newDepartmentId?: string;

  @IsDateString()
  @IsNotEmpty()
  effectiveDate: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  newBasicSalary?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
