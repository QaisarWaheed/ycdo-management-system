import { IsBooleanString, IsNotEmpty, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class UpdateUserPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}

export class UserPasswordsQueryDto {
  @IsOptional()
  @IsBooleanString()
  systemOnly?: string;

  @IsOptional()
  @IsBooleanString()
  employeeOnly?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;
}
