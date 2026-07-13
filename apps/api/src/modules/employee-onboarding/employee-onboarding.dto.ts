import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EmployeeOnboardingStatus } from '@prisma/client';

export class ReviewOnboardingDto {
  @IsOptional()
  @IsString()
  reviewNote?: string;
}

export class RejectOnboardingDto extends ReviewOnboardingDto {}

export class OnboardingQueryDto {
  @IsOptional()
  @IsEnum(EmployeeOnboardingStatus)
  status?: EmployeeOnboardingStatus;
}
