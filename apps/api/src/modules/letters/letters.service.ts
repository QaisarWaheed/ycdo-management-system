import { Injectable, NotFoundException } from '@nestjs/common';
import { LetterType, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerateLetterDto, LetterQueryDto } from './letters.dto';
import {
  getLetterTypeShort,
  LetterData,
  sanitizeRefForFilename,
  TEMPLATE_GENERATORS,
} from './letter-templates.helper';
import { generatePdf } from './pdf.helper';

@Injectable()
export class LettersService {
  constructor(private prisma: PrismaService) {}

  async generate(dto: GenerateLetterDto, actingUserId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: {
        currentBranch: { select: { name: true } },
        currentDepartment: { select: { name: true } },
        salaryRecords: {
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    const year = new Date().getFullYear();
    const typeShort = getLetterTypeShort(dto.letterType);
    const existingCount = await this.prisma.letter.count({
      where: { letterType: dto.letterType },
    });
    const seq = (existingCount + 1).toString().padStart(4, '0');
    const refNumber = `YCDO/${typeShort}/${year}/${seq}`;

    const letterData: LetterData = {
      refNumber,
      date: this.formatDate(new Date()),
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeCode: employee.employeeCode,
      designation: employee.currentDesignation,
      department: employee.currentDepartment.name,
      branch: employee.currentBranch.name,
      cnic: employee.cnic,
      joiningDate: this.formatDate(employee.joiningDate),
      ...(dto.extraFields ?? {}),
    };

    const generateTemplate = TEMPLATE_GENERATORS[dto.letterType];
    const htmlContent = generateTemplate(letterData);
    const pdfBuffer = await generatePdf(htmlContent);

    const fileName = `${sanitizeRefForFilename(refNumber)}.pdf`;
    const dir = path.join(
      process.cwd(),
      'uploads',
      'letters',
      dto.employeeId,
    );
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, pdfBuffer);

    const fileUrl = `/uploads/letters/${dto.employeeId}/${fileName}`;

    const letter = await this.prisma.$transaction(async (tx) => {
      const replyDeadline =
        dto.letterType === LetterType.SHOW_CAUSE
          ? new Date(Date.now() + 48 * 60 * 60 * 1000)
          : undefined;

      const acknowledgementTypes: LetterType[] = [
        LetterType.WARNING,
        LetterType.SHOW_CAUSE,
        LetterType.SUSPENSION,
        LetterType.TERMINATION,
        LetterType.FINE,
        LetterType.DISCIPLINARY,
        LetterType.EXPLANATION,
      ];
      const requiresAcknowledgement = acknowledgementTypes.includes(
        dto.letterType,
      );

      const record = await tx.letter.create({
        data: {
          employeeId: dto.employeeId,
          letterType: dto.letterType,
          content: (dto.extraFields ?? {}) as Prisma.InputJsonValue,
          fileUrl,
          replyDeadline,
          requiresAcknowledgement,
        },
      });

      if (actingUserId !== 'SYSTEM') {
        await tx.auditLog.create({
          data: {
            userId: actingUserId,
            action: 'LETTER_GENERATED',
            entity: 'Letter',
            entityId: record.id,
            changes: {
              letterType: dto.letterType,
              refNumber,
            },
          },
        });
      }

      return record;
    });

    return { letter, previewHtml: htmlContent };
  }

  findAll(query: LetterQueryDto) {
    const where: Prisma.LetterWhereInput = {};

    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }

    if (query.letterType) {
      where.letterType = query.letterType;
    }

    if (query.startDate && query.endDate) {
      where.generatedAt = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    }

    return this.prisma.letter.findMany({
      where,
      include: {
        employee: {
          select: { firstName: true, lastName: true, employeeCode: true },
        },
      },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async findOne(letterId: string) {
    const letter = await this.prisma.letter.findUnique({
      where: { id: letterId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            currentDesignation: true,
          },
        },
      },
    });

    if (!letter) {
      throw new NotFoundException(`Letter with id ${letterId} not found`);
    }

    return letter;
  }

  async getPdf(letterId: string) {
    const letter = await this.findOne(letterId);

    if (!letter.fileUrl) {
      throw new NotFoundException('PDF file not found for this letter');
    }

    const fullPath = path.join(
      process.cwd(),
      letter.fileUrl.replace(/^\//, ''),
    );

    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException('PDF file not found on disk');
    }

    const buffer = fs.readFileSync(fullPath);
    const filename = path.basename(fullPath);

    return { buffer, filename };
  }

  async markPrinted(letterId: string) {
    await this.findOne(letterId);

    return this.prisma.letter.update({
      where: { id: letterId },
      data: { printedAt: new Date() },
    });
  }

  async deleteLetterr(letterId: string) {
    const letter = await this.findOne(letterId);

    if (letter.fileUrl) {
      const fullPath = path.join(
        process.cwd(),
        letter.fileUrl.replace(/^\//, ''),
      );

      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    await this.prisma.letter.delete({
      where: { id: letterId },
    });

    return { message: 'Letter deleted' };
  }

  private formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
