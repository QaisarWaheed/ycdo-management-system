import { LetterStatus, LetterType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  Max,
  Min,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class GenerateLetterDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsEnum(LetterType)
  @IsNotEmpty()
  letterType: LetterType;

  /** Required when letterType is CUSTOM — identifies which LetterTemplate to use. */
  @IsOptional()
  @IsString()
  templateCode?: string;

  @IsOptional()
  @IsObject()
  extraFields?: Record<string, unknown>;
}

export class PreviewLetterDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsEnum(LetterType)
  @IsNotEmpty()
  letterType: LetterType;

  /** Required when letterType is CUSTOM — identifies which LetterTemplate to use. */
  @IsOptional()
  @IsString()
  templateCode?: string;

  @IsOptional()
  @IsObject()
  extraFields?: Record<string, unknown>;
}

export class AppointmentPreviewDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsOptional()
  @IsString()
  cnic?: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsUUID()
  @IsNotEmpty()
  currentDepartmentId: string;

  @IsString()
  @IsNotEmpty()
  currentDesignation: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsOptional()
  @IsString()
  dutyStartTime?: string;

  @IsOptional()
  @IsString()
  dutyEndTime?: string;

  @IsOptional()
  @IsObject()
  extraFields?: Record<string, unknown>;
}

export class UpdateLetterDto {
  @IsOptional()
  @IsObject()
  extraFields?: Record<string, unknown>;

  /** Required when letterType is CUSTOM — identifies which LetterTemplate to use. */
  @IsOptional()
  @IsString()
  templateCode?: string;
}

export class ReverseLetterDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  reason: string;
}

export class RejectLetterApprovalDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class LetterQueryDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(LetterType)
  letterType?: LetterType;

  @IsOptional()
  @IsEnum(LetterStatus)
  status?: LetterStatus;

  @IsOptional()
  @Transform(({ value }) => {
    if (value == null || value === '') return undefined;
    return Array.isArray(value) ? value : String(value).split(',');
  })
  @IsEnum(LetterStatus, { each: true })
  statusIn?: LetterStatus[];

  @IsOptional()
  startDate?: string;

  @IsOptional()
  endDate?: string;

  /** Zero-based page; when set the list is paginated ({ items, total }). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
