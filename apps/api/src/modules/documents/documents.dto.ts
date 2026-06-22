import { DocumentType } from '@prisma/client';
import { IsEnum, IsNotEmpty } from 'class-validator';

export class UploadDocumentDto {
  @IsEnum(DocumentType)
  @IsNotEmpty()
  documentType: DocumentType;
}
