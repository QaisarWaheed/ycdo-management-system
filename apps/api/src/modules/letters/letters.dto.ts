import { LetterType } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

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

export class LetterQueryDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(LetterType)
  letterType?: LetterType;

  @IsOptional()
  startDate?: string;

  @IsOptional()
  endDate?: string;
}
