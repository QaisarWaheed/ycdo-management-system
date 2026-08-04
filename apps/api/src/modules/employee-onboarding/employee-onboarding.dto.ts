import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import {
  EmployeeApproverTarget,
  EmployeeOnboardingStatus,
} from '@prisma/client';

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

/** Build a WhatsApp Web deep-link for onboarding approval outreach. */
export class WhatsAppShareQueryDto {
  @IsOptional()
  @IsEnum(EmployeeApproverTarget)
  approverTarget?: EmployeeApproverTarget;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  /** Optional override if HR wants a different number than the resolved one. */
  @IsOptional()
  @IsString()
  phone?: string;

  /** Public HRMS URL (e.g. https://hrms-web.ycdo.org.pk) used in the message. */
  @IsOptional()
  @IsString()
  hrmsBaseUrl?: string;
}
