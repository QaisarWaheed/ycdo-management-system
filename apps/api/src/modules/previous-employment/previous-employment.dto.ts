import { PartialType } from '@nestjs/mapped-types';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreatePreviousEmploymentDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  organizationName: string;

  @IsOptional()
  @IsString()
  ownerAdminName?: string;

  @IsOptional()
  @IsString()
  contactNumber?: string;

  @IsOptional()
  @IsString()
  postalAddress?: string;

  @IsOptional()
  @IsString()
  totalExperience?: string;

  @IsOptional()
  @IsString()
  relevantExperience?: string;

  @IsOptional()
  @IsString()
  jobResponsibilities?: string;
}

export class UpdatePreviousEmploymentDto extends PartialType(
  CreatePreviousEmploymentDto,
) {}
