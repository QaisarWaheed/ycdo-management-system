import { PartialType } from '@nestjs/mapped-types';
import { ProjectType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(ProjectType)
  @IsNotEmpty()
  type: ProjectType;
}

export class UpdateProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}
