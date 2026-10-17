import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAdditionalDutyDto {
  @IsUUID()
  employeeId: string;

  /** e.g. "Ward In-charge" */
  @IsString()
  @IsNotEmpty({ message: 'Write the duty title' })
  @MaxLength(100)
  title: string;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** `null` clears endDate / note (re-open an ended duty). */
export class UpdateAdditionalDutyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Write the duty title' })
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/** Link (or unlink with null) the EmployeeAllowance paid for this duty. */
export class LinkDutyAllowanceDto {
  @IsOptional()
  @IsUUID()
  allowanceId?: string | null;
}

export class MissingAllowanceQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;
}
