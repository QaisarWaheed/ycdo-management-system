import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateBiometricDeviceDto {
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @IsUUID()
  @IsNotEmpty()
  branchId: string;

  @IsOptional()
  @IsString()
  label?: string;
}

export class UpdateBiometricDeviceDto {
  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  label?: string;
}
