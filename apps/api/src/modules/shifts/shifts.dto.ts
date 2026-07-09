import { PartialType } from '@nestjs/mapped-types';
import {
  IsNotEmpty,
  IsString,
  Matches,
} from 'class-validator';

export class CreateShiftDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  startTime: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  endTime: string;
}

export class UpdateShiftDto extends PartialType(CreateShiftDto) {}
