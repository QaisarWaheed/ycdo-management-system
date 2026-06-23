import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class SendReminderDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  message: string;
}
