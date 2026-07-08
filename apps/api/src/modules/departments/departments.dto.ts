import { PartialType } from '@nestjs/mapped-types';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUUID()
  branchId: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

export class DepartmentQueryDto {
  @IsOptional()
  @IsString()
  branchId?: string;
}
