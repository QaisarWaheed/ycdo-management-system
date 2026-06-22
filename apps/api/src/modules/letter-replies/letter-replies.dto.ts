import {
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateLetterReplyDto {
  @IsUUID()
  @IsNotEmpty()
  letterId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  replyText: string;
}
