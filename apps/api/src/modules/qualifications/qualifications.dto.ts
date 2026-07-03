import { PartialType } from '@nestjs/mapped-types';
import { QualType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
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
  totalMarks?: string;

  @IsOptional()
  @IsIn(['MARKS', 'CGPA'])
  marksType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(4)
  cgpa?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2099)
  startYear?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2099)
  endYear?: number;

  @IsOptional()
  @IsString()
  divisionGrade?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
export class UpdateQualificationDto extends PartialType(CreateQualificationDto) {}
