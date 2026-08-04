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
import {
  GenerateLetterDto,
  LetterQueryDto,
  PreviewLetterDto,
} from './letters.dto';
import {
  DEFAULT_SENDER_TITLE,
  defaultSubjectFor,
  parseAttendanceRows,
  parseViolationLines,
  renderLetterHtml,
  sanitizeRefForFilename,
  templateCodeForLetterType,
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

const ACKNOWLEDGEMENT_TYPES: LetterType[] = [
  LetterType.WARNING,
  LetterType.SHOW_CAUSE,
  LetterType.SUSPENSION,
  LetterType.TERMINATION,
  LetterType.FINE,
  LetterType.DISCIPLINARY,
  LetterType.EXPLANATION,
  LetterType.APPOINTMENT,
];

@Injectable()
export class LettersService {
  constructor(
    private prisma: PrismaService,
    private accessScopeService: AccessScopeService,
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

  async preview(
    dto: PreviewLetterDto,
    actingUserId: string,
    actingRole: UserRole,
  ) {
    await this.accessScopeService.assertEmployeeAccess(
      actingUserId,
      actingRole,
      Permission.LETTERS_GENERATE,
      dto.employeeId,
    );

    if (dto.letterType === LetterType.APPOINTMENT) {
      const { htmlContent, variables } = await this.buildSelectionLetterHtml(
        dto.employeeId,
        dto.extraFields ?? {},
        { letterNo: 'PREVIEW/YCDO/0000', consumeNumber: false },
      );
      return { previewHtml: htmlContent, variables };
    }

    const built = await this.buildTemplatedLetterHtml(
      dto.employeeId,
      dto.letterType,
      dto.extraFields ?? {},
      'PREVIEW/YCDO/0000',
    );
    return { previewHtml: built.htmlContent, variables: built.variables };
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

    return this.generateTemplatedLetter(dto, actingUserId);
  }

  /**
   * System / internal callers that already checked access.
   * Renders the seeded template PDF and creates the Letter row.
   */
  async generateSystemLetter(
    dto: GenerateLetterDto,
    actingUserId = 'SYSTEM',
  ) {
    if (dto.letterType === LetterType.APPOINTMENT) {
      return this.generateSelectionLetter(dto, actingUserId);
    }
    return this.generateTemplatedLetter(dto, actingUserId);
  }

  private async generateSelectionLetter(
    dto: GenerateLetterDto,
    actingUserId: string,
  ) {
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

    return { letter, previewHtml: htmlContent };
  }

  private async generateTemplatedLetter(
    dto: GenerateLetterDto,
    actingUserId: string,
  ) {
    await this.buildTemplatedLetterHtml(
      dto.employeeId,
      dto.letterType,
      dto.extraFields ?? {},
      'PENDING',
    );

    const letterNo = await this.nextLetterNo();
    const built = await this.buildTemplatedLetterHtml(
      dto.employeeId,
      dto.letterType,
      dto.extraFields ?? {},
      letterNo,
    );

    const pdfBuffer = await generatePdf(built.htmlContent);
    const fileUrl = await this.persistPdf(pdfBuffer, letterNo, dto.employeeId);

    const replyDeadline =
      dto.letterType === LetterType.SHOW_CAUSE
        ? new Date(Date.now() + 48 * 60 * 60 * 1000)
        : undefined;

    const letter = await this.prisma.$transaction(async (tx) => {
      const record = await tx.letter.create({
        data: {
          employeeId: dto.employeeId,
          letterType: dto.letterType,
          content: (dto.extraFields ?? {}) as Prisma.InputJsonValue,
          fileUrl,
          letterNo,
          variables: built.variables as Prisma.InputJsonValue,
          templateVersion: built.templateVersion,
          replyDeadline,
          requiresAcknowledgement: ACKNOWLEDGEMENT_TYPES.includes(
            dto.letterType,
          ),
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
              letterNo,
            },
          },
        });
      }

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'LETTER_ISSUED',
          message: `A ${dto.letterType.replace(/_/g, ' ')} letter (${letterNo}) has been issued to you.`,
        },
      });

      return record;
    });

    return { letter, previewHtml: built.htmlContent };
  }

  private async buildTemplatedLetterHtml(
    employeeId: string,
    letterType: LetterType,
    extraFields: Record<string, unknown>,
    letterNo: string,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        currentBranch: { select: { name: true, address: true } },
        currentDepartment: { select: { name: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${employeeId} not found`,
      );
    }

    const code = templateCodeForLetterType(letterType);
    const template = await this.prisma.letterTemplate.findFirst({
      where: { code, active: true },
    });

    if (!template) {
      throw new NotFoundException(
        `Letter template ${code} is not seeded. Run prisma db seed.`,
      );
    }

    const normalized = this.normalizeExtraFields(letterType, extraFields);

    const requiredMissing: string[] = [];
    for (const key of template.requiredVars) {
      const value = normalized[key];
      if (key === 'violations') {
        const lines = parseViolationLines(value);
        if (!lines.length) requiredMissing.push(key);
        continue;
      }
      if (value === undefined || value === null || String(value).trim() === '') {
        requiredMissing.push(key);
      }
    }
    if (requiredMissing.length) {
      throw new BadRequestException(
        `Missing required fields: ${requiredMissing.join(', ')}`,
      );
    }

    const previousSalary = Number(normalized.previousSalary ?? 0);
    const newSalary = Number(normalized.newSalary ?? 0);
    const incrementAmount =
      normalized.incrementAmount ??
      (newSalary && previousSalary
        ? String(newSalary - previousSalary)
        : (normalized.enhancement ?? ''));

    const variables: Record<string, unknown> = {
      letterNo,
      issueDate: formatIssueDatePkt(),
      senderTitle:
        String(normalized.senderTitle ?? '').trim() || DEFAULT_SENDER_TITLE,
      subject:
        String(normalized.subject ?? '').trim() ||
        defaultSubjectFor(letterType),
      employeeName: employee.fullName,
      employeeCode: employee.employeeCode,
      designation: employee.currentDesignation ?? '',
      department: employee.currentDepartment?.name ?? '',
      branch: employee.currentBranch?.name ?? '',
      cnic: employee.cnic ?? '',
      joiningDate: employee.joiningDate
        ? this.formatDate(employee.joiningDate)
        : '',
      ...normalized,
      violations: parseViolationLines(
        normalized.violations ?? normalized.warningReason,
      ),
      attendanceRows: parseAttendanceRows(normalized.attendanceRows),
      incrementAmount: String(incrementAmount),
      timing: String(normalized.timing ?? '').trim() || 'As per duty roster',
    };

    const htmlContent = renderLetterHtml(template.bodyHtml, variables);

    return {
      htmlContent,
      variables,
      templateVersion: template.version,
    };
  }

  private normalizeExtraFields(
    letterType: LetterType,
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...extra };

    if (letterType === LetterType.WARNING) {
      if (!out.violations && out.warningReason) {
        out.violations = out.warningReason;
      }
    }
    if (letterType === LetterType.DISCIPLINARY) {
      if (!out.disciplinaryReason && out.violationType) {
        out.disciplinaryReason = [
          out.violationType,
          out.actionTaken,
          out.incidentDate,
        ]
          .filter(Boolean)
          .join(' — ');
      }
    }
    if (letterType === LetterType.EXPLANATION) {
      if (!out.issueDescription && out.additionalNotes) {
        out.issueDescription = out.additionalNotes;
      }
    }
    if (letterType === LetterType.ADVICE) {
      if (!out.adviceReason && out.additionalNotes) {
        out.adviceReason = out.additionalNotes;
      }
    }
    if (letterType === LetterType.SALARY_INCREMENT) {
      if (!out.incrementAmount && out.previousSalary && out.newSalary) {
        out.incrementAmount = String(
          Number(out.newSalary) - Number(out.previousSalary),
        );
      }
    }

    return out;
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

    if (
      letter.fileUrl.startsWith('http://') ||
      letter.fileUrl.startsWith('https://')
    ) {
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
