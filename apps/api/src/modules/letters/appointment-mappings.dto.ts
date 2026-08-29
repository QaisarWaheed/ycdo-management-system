import { AppointmentLetterLanguage } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateAppointmentMappingDto {
  @IsUUID()
  @IsNotEmpty()
  departmentId: string;

  @IsOptional()
  @IsUUID()
  designationId?: string | null;

  /** When true, designationId may be omitted (department-level fallback). */
  @IsOptional()
  @IsBoolean()
  applyToUnmappedDesignations?: boolean;

  @IsEnum(AppointmentLetterLanguage)
  language: AppointmentLetterLanguage;

  @IsString()
  @IsNotEmpty()
  templateCode: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateAppointmentMappingDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  designationId?: string | null;

  @IsOptional()
  @IsBoolean()
  applyToUnmappedDesignations?: boolean;

  @IsOptional()
  @IsEnum(AppointmentLetterLanguage)
  language?: AppointmentLetterLanguage;

  @IsOptional()
  @IsString()
  templateCode?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AppointmentMappingPreviewDto {
  @IsOptional()
  @IsUUID()
  mappingId?: string;

  @IsOptional()
  @IsString()
  templateCode?: string;

  @IsOptional()
  @IsString()
  departmentName?: string;
}
