import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { EmployeeOnboardingStatus } from '@prisma/client';

export class ReviewOnboardingDto {
  @IsOptional()
  @IsString()
  reviewNote?: string;
}

/** A rejection must always carry the reason shown back to HR. */
export class RejectOnboardingDto {
  @IsString()
  @IsNotEmpty({ message: 'A reason is required to reject this application' })
  @MinLength(5, { message: 'Please give a reason of at least 5 characters' })
  reviewNote: string;
}

export class OnboardingQueryDto {
  @IsOptional()
  @IsEnum(EmployeeOnboardingStatus)
  status?: EmployeeOnboardingStatus;
}
