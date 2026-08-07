import { IsOptional, IsString, IsUUID } from 'class-validator';

/** Placeholder query DTO — extend as Finance features are defined. */
export class FinanceQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
