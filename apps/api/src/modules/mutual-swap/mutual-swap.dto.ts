import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateMutualSwapDto {
  @IsUUID()
  coveringEmployeeId!: string;

  @IsUUID()
  coveredEmployeeId!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class MutualSwapQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

export class EligibleCoveringQueryDto {
  @IsUUID()
  coveredEmployeeId!: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}
