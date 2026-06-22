import { PartialType } from '@nestjs/mapped-types';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUUID()
  branchId: string;
}

export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}
