import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateLocationValueDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  value: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  city?: string;
}

export class UpdateLocationValueDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  value?: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  city?: string;
}
