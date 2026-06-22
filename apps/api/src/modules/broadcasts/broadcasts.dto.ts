import { BroadcastTarget } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateBroadcastDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;

  @IsEnum(BroadcastTarget)
  @IsNotEmpty()
  targetRole: BroadcastTarget;
}
