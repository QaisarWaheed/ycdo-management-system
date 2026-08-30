import {
  DisciplinaryStatus,
  DisciplinaryType,
  InquiryFinding,
  InquiryFinalAction,
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
  @IsString()
  @MaxLength(2000)
  decision?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  duration?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  durationDays?: number;

  @IsOptional()
  @IsObject()
  extraLetterFields?: Record<string, unknown>;
}

export class PrepareSuspensionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @IsDateString()
  @IsNotEmpty()
  periodStart: string;

  @IsDateString()
  @IsNotEmpty()
  periodEnd: string;

  @IsUUID()
  @IsNotEmpty()
  inquiryOfficerUserId: string;

  @IsDateString()
  @IsNotEmpty()
  inquiryDeadlineAt: string;

  @IsUUID()
  @IsNotEmpty()
  selectedApproverUserId: string;
}

export class UpdateSuspensionRequestDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsUUID()
  inquiryOfficerUserId?: string;

  @IsOptional()
  @IsDateString()
  inquiryDeadlineAt?: string;

  @IsOptional()
  @IsUUID()
  selectedApproverUserId?: string;
}

export class RecordInquiryFindingDto {
  @IsEnum(InquiryFinding)
  @IsNotEmpty()
  finding: InquiryFinding;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class SubmitInquiryFinalDecisionDto {
  @IsUUID()
  @IsNotEmpty()
  selectedApproverUserId: string;

  @IsOptional()
  @IsEnum(InquiryFinalAction)
  finalAction?: InquiryFinalAction;

  @IsOptional()
  @IsUUID()
  destinationBranchId?: string;

  @IsOptional()
  @Type(() => Number)
  fineAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CloseInquiryDto {
  @IsEnum(InquiryFinding)
  @IsNotEmpty()
  finding: InquiryFinding;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  closeRecommendation?: string;

  @IsOptional()
  @IsUUID()
  selectedApproverUserId?: string;

  @IsOptional()
  @IsEnum(InquiryFinalAction)
  finalAction?: InquiryFinalAction;

  @IsOptional()
  @IsUUID()
  destinationBranchId?: string;

  @IsOptional()
  @Type(() => Number)
  fineAmount?: number;
}

export class StartDueInquiryDto {
  @IsUUID()
  @IsNotEmpty()
  inquiryOfficerUserId: string;

  @IsUUID()
  @IsNotEmpty()
  selectedApproverUserId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  durationDays: number;
}

export class DecideSuspensionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class RejectSuspensionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
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
