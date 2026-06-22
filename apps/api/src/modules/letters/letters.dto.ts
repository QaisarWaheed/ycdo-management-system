import { LetterType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsUUID } from 'class-validator';

export class GenerateLetterDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsEnum(LetterType)
  @IsNotEmpty()
  letterType: LetterType;

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
