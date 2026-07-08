import { PartialType } from '@nestjs/mapped-types';
import { ProjectType } from '@prisma/client';
import {
  IsBooleanString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}

export class UpdateBranchDto extends PartialType(CreateBranchDto) {}

export class BranchQueryDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsEnum(ProjectType)
  project?: ProjectType;

  @IsOptional()
  @IsBooleanString()
  groupByName?: string;
}
