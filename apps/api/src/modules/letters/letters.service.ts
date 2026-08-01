import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Gender, LetterType, Permission, Prisma, UserRole } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  isCloudinaryEnabled,
  uploadPdfToCloudinary,
} from '../../config/cloudinary.config';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScopeService } from '../permissions/access-scope.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import {
  GenerateLetterDto,
  LetterQueryDto,
  PreviewLetterDto,
} from './letters.dto';
import {
  getLetterTypeShort,
  LetterData,
  sanitizeRefForFilename,
  TEMPLATE_GENERATORS,
} from './letter-templates.helper';
import { generatePdf } from './pdf.helper';
import {
  buildOrgVariables,
  formatIssueDatePkt,
  pktYear,
  renderHandlebarsTemplate,
  salutationFromGender,
  scheduleFromDuty,
  SelectionLetterVariables,
} from './selection-letter.helper';

const SELECTION_TEMPLATE_CODE = 'SELECTION_LETTER';

@Injectable()
export class LettersService {
  constructor(
    private prisma: PrismaService,
    private accessScopeService: AccessScopeService,
    private whatsappService: WhatsAppService,
  ) {}

  async nextLetterNo(): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('letter_no_seq') AS nextval
    `;
    const next = rows[0]?.nextval;
    if (next == null) {
      throw new BadRequestException('Failed to allocate letter number');
    }
    return `${next}/YCDO/${pktYear()}`;
  }

  async listTemplates() {
    return this.prisma.letterTemplate.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        requiredVars: true,
        version: true,
      },
    });
  }

  async preview(dto: PreviewLetterDto, actingUserId: string, actingRole: UserRole) {
    await this.accessScopeService.assertEmployeeAccess(
      actingUserId,
      actingRole,
      Permission.LETTERS_GENERATE,
      dto.employeeId,
    );

    if (dto.letterType !== LetterType.APPOINTMENT) {
      throw new BadRequestException(
        'Preview is only supported for Appointment / Selection letters',
      );
    }

    const { htmlContent, variables } = await this.buildSelectionLetterHtml(
      dto.employeeId,
      dto.extraFields ?? {},
      { letterNo: 'PREVIEW/YCDO/0000', consumeNumber: false },
    );

    return { previewHtml: htmlContent, variables };
  }

  async generate(
    dto: GenerateLetterDto,
    actingUserId: string,
    actingRole: UserRole = UserRole.HR_MANAGER,
  ) {
    await this.accessScopeService.assertEmployeeAccess(
      actingUserId,
      actingRole,
      Permission.LETTERS_GENERATE,
      dto.employeeId,
    );

    if (dto.letterType === LetterType.APPOINTMENT) {
      return this.generateSelectionLetter(dto, actingUserId);
    }

    return this.generateLegacyLetter(dto, actingUserId);
  }

  private async generateSelectionLetter(
    dto: GenerateLetterDto,
    actingUserId: string,
  ) {
    // Validate profile + required vars BEFORE consuming a sequence number
    const prepared = await this.buildSelectionLetterHtml(
      dto.employeeId,
      dto.extraFields ?? {},
      { letterNo: 'PENDING', consumeNumber: false },
    );

    const letterNo = await this.nextLetterNo();
    const variables: SelectionLetterVariables = {
      ...prepared.variables,
      letterNo,
    };
    const htmlContent = renderHandlebarsTemplate(
      prepared.bodyHtml,
      variables,
    );
    const pdfBuffer = await generatePdf(htmlContent);
    const fileUrl = await this.persistPdf(
      pdfBuffer,
      letterNo,
      dto.employeeId,
    );

    const letter = await this.prisma.$transaction(async (tx) => {
      const record = await tx.letter.create({
        data: {
          employeeId: dto.employeeId,
          letterType: LetterType.APPOINTMENT,
          content: (dto.extraFields ?? {}) as Prisma.InputJsonValue,
          fileUrl,
          letterNo,
          variables: variables as Prisma.InputJsonValue,
          templateVersion: prepared.templateVersion,
          requiresAcknowledgement: true,
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
              letterType: LetterType.APPOINTMENT,
              letterNo,
            },
          },
        });
      }

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'LETTER_ISSUED',
          message: `An Appointment/Selection Letter (${letterNo}) has been issued to you.`,
        },
      });

      return record;
    });

    await this.whatsappService.deliverAfterLetterGenerated({
      letterId: letter.id,
      employeeId: dto.employeeId,
      employeeName: String(variables.employeeName),
      letterType: LetterType.APPOINTMENT,
      phone: prepared.phone,
      fileUrl,
      pdfBuffer,
      filename: `${sanitizeRefForFilename(letterNo)}.pdf`,
    });

    return { letter, previewHtml: htmlContent };
  }

  private async buildSelectionLetterHtml(
    employeeId: string,
    extraFields: Record<string, unknown>,
    opts: { letterNo: string; consumeNumber: boolean },
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        currentBranch: { select: { name: true } },
        currentDepartment: { select: { name: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }

    const missing: string[] = [];
    if (!employee.cnic) missing.push('CNIC');
    if (!employee.phone) missing.push('Phone');
    if (!employee.currentDesignation) missing.push('Designation');
    if (!employee.currentDepartment?.name) missing.push('Department');
    if (!employee.currentBranch?.name) missing.push('Branch');
    if (!employee.dutyStartTime || !employee.dutyEndTime) {
      missing.push('Duty times');
    }

    if (missing.length) {
      throw new BadRequestException(
        `Cannot issue letter — employee profile is missing: ${missing.join(', ')}. Complete the profile first.`,
      );
    }

    const template = await this.prisma.letterTemplate.findFirst({
      where: { code: SELECTION_TEMPLATE_CODE, active: true },
    });

    if (!template) {
      throw new NotFoundException(
        'SELECTION_LETTER template is not seeded. Run prisma db seed.',
      );
    }

    const requiredMissing: string[] = [];
    for (const key of template.requiredVars) {
      const value = extraFields[key];
      if (value === undefined || value === null || String(value).trim() === '') {
        requiredMissing.push(key);
      }
    }
    if (requiredMissing.length) {
      throw new BadRequestException(
        `Missing required fields: ${requiredMissing.join(', ')}`,
      );
    }

    const schedule = scheduleFromDuty(employee);
    const variables: SelectionLetterVariables = {
      ...buildOrgVariables(),
      letterNo: opts.letterNo,
      issueDate: formatIssueDatePkt(),
      salutation: salutationFromGender(employee.gender as Gender),
      employeeName: employee.fullName,
      cnic: employee.cnic!,
      phone: employee.phone!,
      designation: employee.currentDesignation!,
      department: employee.currentDepartment!.name,
      branchName: employee.currentBranch!.name,
      scheduleFrom: schedule.scheduleFrom,
      scheduleTo: schedule.scheduleTo,
      stipendAmount: String(extraFields.stipendAmount).trim(),
      hoursPerDay: String(extraFields.hoursPerDay).trim(),
      shiftName: String(extraFields.shiftName).trim(),
      capacity: String(extraFields.capacity).trim(),
      digitalAcceptance: false,
    };

    const htmlContent = renderHandlebarsTemplate(template.bodyHtml, variables);

    return {
      htmlContent,
      variables,
      bodyHtml: template.bodyHtml,
      templateVersion: template.version,
      phone: employee.phone,
    };
  }

  private async persistPdf(
    pdfBuffer: Buffer,
    letterNo: string,
    employeeId: string,
  ): Promise<string> {
    const publicId = letterNo.replace(/\//g, '-');

    if (isCloudinaryEnabled()) {
      return uploadPdfToCloudinary(pdfBuffer, publicId, 'letters');
    }

    const fileName = `${sanitizeRefForFilename(letterNo)}.pdf`;
    const dir = path.join(process.cwd(), 'uploads', 'letters', employeeId);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, pdfBuffer);
    return `/uploads/letters/${employeeId}/${fileName}`;
  }

  private async generateLegacyLetter(
    dto: GenerateLetterDto,
    actingUserId: string,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: {
        currentBranch: { select: { name: true, address: true } },
        currentDepartment: { select: { name: true } },
        stipendRecords: {
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
      employeeName: employee.fullName,
      employeeCode: employee.employeeCode,
      designation: employee.currentDesignation ?? '',
      department: employee.currentDepartment?.name ?? '',
      branch: employee.currentBranch?.name ?? '',
      cnic: employee.cnic ?? '',
      joiningDate: this.formatDate(employee.joiningDate),
      ...(dto.extraFields ?? {}),
    };

    const generateTemplate = TEMPLATE_GENERATORS[dto.letterType];
    if (!generateTemplate) {
      throw new BadRequestException(
        `No template generator for letter type ${dto.letterType}`,
      );
    }
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
        LetterType.APPOINTMENT,
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

    await this.whatsappService.deliverAfterLetterGenerated({
      letterId: letter.id,
      employeeId: dto.employeeId,
      employeeName: employee.fullName,
      letterType: dto.letterType,
      phone: employee.phone,
      fileUrl,
      pdfBuffer,
      filename: fileName,
    });

    return { letter, previewHtml: htmlContent };
  }

  async findAll(
    query: LetterQueryDto,
    actingUser?: { id: string; role: UserRole },
  ) {
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

    if (actingUser?.id) {
      where.employee =
        await this.accessScopeService.narrowEmployeeWhereForActor(
          actingUser.id,
          actingUser.role,
          {},
        );
    }

    return this.prisma.letter.findMany({
      where,
      include: {
        employee: {
          select: { fullName: true, employeeCode: true },
        },
        acknowledgement: true,
        replies: {
          select: { id: true, repliedAt: true },
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
            fullName: true,
            employeeCode: true,
            currentDesignation: true,
          },
        },
        acknowledgement: true,
        replies: true,
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

    if (letter.fileUrl.startsWith('http://') || letter.fileUrl.startsWith('https://')) {
      const response = await fetch(letter.fileUrl);
      if (!response.ok) {
        throw new NotFoundException(
          'File unavailable — please reissue this letter',
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      const filename =
        (letter.letterNo ?? letter.id).replace(/\//g, '-') + '.pdf';
      return { buffer: Buffer.from(arrayBuffer), filename };
    }

    const fullPath = path.join(
      process.cwd(),
      letter.fileUrl.replace(/^\//, ''),
    );

    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException(
        'File unavailable — please reissue this letter',
      );
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

    if (letter.fileUrl && !letter.fileUrl.startsWith('http')) {
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
