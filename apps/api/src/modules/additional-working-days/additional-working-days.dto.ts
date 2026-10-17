import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAdditionalWorkingDayDto {
  @IsUUID()
  employeeId: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReviewExtraTimeDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
