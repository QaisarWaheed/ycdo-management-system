import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Permission, UserRole } from '@prisma/client';

export class UserAccessQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  employeeOnly?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  systemOnly?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  activeOnly?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class PermissionOverrideDto {
  @IsEnum(Permission)
  permission: Permission;

  /** Omit or null = remove override (use role default). */
  @IsOptional()
  @IsBoolean()
  granted?: boolean | null;
}

export class UpdateUserAccessDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionOverrideDto)
  permissions?: PermissionOverrideDto[];
}

export class CreateSystemLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class ResetLoginPasswordDto {
  @IsString()
  @MinLength(6)
  newPassword: string;
}
