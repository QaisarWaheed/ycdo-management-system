import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  IsDateString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Applicant Auth ──────────────────────────────────────────

export class RegisterApplicantDto {
  @IsString() fullName: string;
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
  @IsOptional() @IsString() phone?: string;
}

export class LoginApplicantDto {
  @IsEmail() email: string;
  @IsString() password: string;
}

// ── HR: Job Postings ────────────────────────────────────────

export class CreateJobDto {
  @IsString() title: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() requirements?: string;
  @IsOptional() @IsDateString() deadline?: string;
  @IsOptional() @IsEnum(['DRAFT', 'OPEN', 'CLOSED']) status?: string;
}

export class UpdateJobDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() requirements?: string;
  @IsOptional() @IsDateString() deadline?: string;
  @IsOptional() @IsEnum(['DRAFT', 'OPEN', 'CLOSED']) status?: string;
}

// ── Applicant: Job Application ──────────────────────────────

export class AcademicRecordDto {
  @IsString() degree: string;
  @IsString() institution: string;
  @IsOptional() @IsString() year?: string;
  @IsOptional() @IsString() grade?: string;
}

export class ExperienceDto {
  @IsString() organization: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() responsibilities?: string;
}

export class SubmitApplicationDto {
  // BIO
  @IsOptional() @IsString() fatherName?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsEnum(['MALE', 'FEMALE', 'OTHER']) gender?: string;
  @IsOptional() @IsString() cnic?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;

  // Academic
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AcademicRecordDto)
  academicRecords?: AcademicRecordDto[];

  // Experience
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ExperienceDto)
  experiences?: ExperienceDto[];

  @IsOptional() @IsString() coverLetter?: string;
}

// ── HR: Update application status ──────────────────────────

export class UpdateApplicationStatusDto {
  @IsEnum(['PENDING', 'REVIEWING', 'SHORTLISTED', 'REJECTED', 'HIRED'], {
    message: 'status must be one of: PENDING, REVIEWING, SHORTLISTED, REJECTED, HIRED',
  })
  status: string;
}
