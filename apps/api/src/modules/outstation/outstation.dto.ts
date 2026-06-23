import { OutstationStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateOutstationDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  district: string;

  @IsString()
  @IsNotEmpty()
  purpose: string;

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateOutstationStatusDto {
  @IsEnum(OutstationStatus)
  @IsNotEmpty()
  status: OutstationStatus;

  @IsOptional()
  @IsString()
  approvedBy?: string;
}

export class OutstationQueryDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsEnum(OutstationStatus)
  status?: OutstationStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
