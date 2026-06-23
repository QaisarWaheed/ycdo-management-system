import { PartialType } from '@nestjs/mapped-types';
import { QualType } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateQualificationDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsEnum(QualType)
  @IsNotEmpty()
  qualType: QualType;

  @IsString()
  @IsNotEmpty()
  degree: string;

  @IsString()
  @IsNotEmpty()
  boardUniversity: string;

  @IsOptional()
  @IsString()
  obtainedMarks?: string;

  @IsOptional()
  @IsString()
  divisionGrade?: string;
}

export class UpdateQualificationDto extends PartialType(CreateQualificationDto) {}
