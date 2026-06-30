import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class UpdateUserPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}
