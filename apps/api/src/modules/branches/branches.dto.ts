import { PartialType } from '@nestjs/mapped-types';
import { IsNotEmpty, IsString, IsUUID, ValidateIf } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  address?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  phone?: string | null;

  @ValidateIf(
    (_, value) => value !== null && value !== undefined && value !== '',
  )
  @IsUUID()
  projectId?: string | null;
}

export class UpdateBranchDto extends PartialType(CreateBranchDto) {}
