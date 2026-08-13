import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class LetterFieldDefDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsOptional()
  @IsIn(['text', 'textarea', 'number', 'date', 'select'])
  type?: string;

  @IsOptional()
  @IsString()
  hint?: string;

  @IsOptional()
  @IsBoolean()
  onTemplate?: boolean;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsArray()
  options?: { value: string; label: string }[];
}

export class CreateLetterTemplateDto {
  @IsString()
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'code must be UPPERCASE letters, numbers, and underscores only',
  })
  @MaxLength(60)
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  bodyHtml: string;

  @IsOptional()
  @IsString()
  bodyHtmlEn?: string;

  @IsOptional()
  @IsString()
  subjectUr?: string;

  @IsOptional()
  @IsString()
  subjectEn?: string;

  @IsOptional()
  @IsString()
  enTitle?: string;

  @IsOptional()
  @IsString()
  enPrescribed?: string;

  @IsOptional()
  @IsString()
  enSubtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6)
  letterCode?: string;

  @IsOptional()
  @IsIn(['ur', 'en'])
  primaryLanguage?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique((f: LetterFieldDefDto) => f.key)
  @ValidateNested({ each: true })
  @Type(() => LetterFieldDefDto)
  fieldsSchema?: LetterFieldDefDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredVars?: string[];
}

export class UpdateLetterTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsString()
  bodyHtmlEn?: string;

  @IsOptional()
  @IsString()
  subjectUr?: string;

  @IsOptional()
  @IsString()
  subjectEn?: string;

  @IsOptional()
  @IsString()
  enTitle?: string;

  @IsOptional()
  @IsString()
  enPrescribed?: string;

  @IsOptional()
  @IsString()
  enSubtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6)
  letterCode?: string;

  @IsOptional()
  @IsIn(['ur', 'en'])
  primaryLanguage?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique((f: LetterFieldDefDto) => f.key)
  @ValidateNested({ each: true })
  @Type(() => LetterFieldDefDto)
  fieldsSchema?: LetterFieldDefDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredVars?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class PreviewLetterTemplateDto {
  @IsString()
  bodyHtml: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;
}
