import { Injectable, NotFoundException } from '@nestjs/common';
import archiver from 'archiver';
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

  /** Open one document of this employee as a stream (404 if missing on disk). */
  async openFile(employeeId: string, documentId: string) {
    const document = await this.findOne(documentId);
    if (document.employeeId !== employeeId) {
      throw new NotFoundException(`Document with id ${documentId} not found`);
    }
    const fullPath = resolveUploadPath(document.fileUrl);
    return { document, stream: fs.createReadStream(fullPath) };
  }

  /** ZIP of the chosen documents (all of them when `documentIds` is empty). */
  async zipFiles(employeeId: string, documentIds: string[]) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { employeeCode: true, fullName: true },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }
    const documents = await this.prisma.employeeDocument.findMany({
      where: {
        employeeId,
        ...(documentIds.length ? { id: { in: documentIds } } : {}),
      },
      orderBy: { uploadedAt: 'asc' },
    });
    if (!documents.length) {
      throw new NotFoundException('No documents to download');
    }

    const archive = archiver('zip');
    const usedNames = new Set<string>();
    for (const doc of documents) {
      let fullPath: string;
      try {
        fullPath = resolveUploadPath(doc.fileUrl);
      } catch {
        continue; // file lost on disk — skip rather than fail the whole ZIP
      }
      archive.file(fullPath, {
        name: uniqueName(`${doc.documentType}-${doc.fileName}`, usedNames),
      });
    }
    void archive.finalize();

    const base = safeFileName(`${employee.employeeCode}-${employee.fullName}`);
    return { stream: archive, filename: `${base}-documents.zip` };
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

/** Map a stored `/uploads/...` URL to its file on disk, refusing path escapes. */
export function resolveUploadPath(fileUrl: string): string {
  const root = path.join(process.cwd(), 'uploads');
  const fullPath = path.resolve(process.cwd(), fileUrl.replace(/^\/+/, ''));
  if (!fullPath.startsWith(root + path.sep) || !fs.existsSync(fullPath)) {
    throw new NotFoundException('File not found');
  }
  return fullPath;
}

export function safeFileName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '').trim() || 'file';
}

function uniqueName(name: string, used: Set<string>): string {
  const clean = safeFileName(name);
  const ext = path.extname(clean);
  const stem = clean.slice(0, clean.length - ext.length);
  let candidate = clean;
  for (let i = 2; used.has(candidate); i++) candidate = `${stem} (${i})${ext}`;
  used.add(candidate);
  return candidate;
}
