import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class ReportResultDto {
  @IsUUID()
  @IsNotEmpty()
  jobId: string;

  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsIn(['SUCCESS', 'FAILED'])
  status: 'SUCCESS' | 'FAILED';

  @IsOptional()
  @IsString()
  error?: string;
}
