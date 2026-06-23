import { IsNotEmpty, IsUUID } from 'class-validator';

export class AcknowledgeDto {
  @IsUUID()
  @IsNotEmpty()
  letterId: string;
}
