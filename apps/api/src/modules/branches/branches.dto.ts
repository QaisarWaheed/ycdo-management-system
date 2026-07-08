import { PartialType } from '@nestjs/mapped-types';
import { ProjectType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

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
  @IsUUID()
  projectId?: string;
}

export class UpdateBranchDto extends PartialType(CreateBranchDto) {}

export class BranchQueryDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsEnum(ProjectType)
  project?: ProjectType;
}
