import {
  DisciplinaryStatus,
  DisciplinaryType,
  InquiryOutcome,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateDisciplinaryDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsEnum(DisciplinaryType)
  @IsNotEmpty()
  type: DisciplinaryType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @IsOptional()
  @IsDateString()
  issuedAt?: string;
}

export class UpdateDisciplinaryStatusDto {
  @IsEnum(DisciplinaryStatus)
  @IsNotEmpty()
  status: DisciplinaryStatus;

  @IsOptional()
  @IsString()
  resolution?: string;
}

export class StartInquiryDto {
  @IsUUID()
  @IsNotEmpty()
  disciplinaryActionId: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  deadlineDays?: number;
}

export class ResolveInquiryDto {
  @IsUUID()
  @IsNotEmpty()
  inquiryId: string;

  @IsEnum(InquiryOutcome)
  @IsNotEmpty()
  outcome: InquiryOutcome;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  extraLetterFields?: Record<string, unknown>;
}

export class DisciplinaryQueryDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(DisciplinaryType)
  type?: DisciplinaryType;

  @IsOptional()
  @IsEnum(DisciplinaryStatus)
  status?: DisciplinaryStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
