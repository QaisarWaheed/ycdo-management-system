import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadDocumentDto } from './documents.dto';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  async upload(
    employeeId: string,
    dto: UploadDocumentDto,
    file: Express.Multer.File,
  ) {
    await this.ensureEmployeeExists(employeeId);

    const fileUrl = `/uploads/documents/${employeeId}/${file.filename}`;

    return this.prisma.employeeDocument.create({
      data: {
        employeeId,
        documentType: dto.documentType,
        fileName: file.originalname,
        fileUrl,
      },
    });
  }

  async findAll(employeeId: string) {
    await this.ensureEmployeeExists(employeeId);

    return this.prisma.employeeDocument.findMany({
      where: { employeeId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async findOne(documentId: string) {
    const document = await this.prisma.employeeDocument.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException(`Document with id ${documentId} not found`);
    }

    return document;
  }

  async delete(documentId: string) {
    const document = await this.findOne(documentId);

    const fullPath = path.join(
      process.cwd(),
      document.fileUrl.replace(/^\//, ''),
    );

    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    await this.prisma.employeeDocument.delete({
      where: { id: documentId },
    });

    return { message: 'Document deleted successfully' };
  }

  private async ensureEmployeeExists(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }
  }
}
