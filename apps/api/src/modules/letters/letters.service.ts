import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Gender,
  LetterType,
  Permission,
  Prisma,
  UserRole,
  WhatsAppSendStatus,
} from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  isCloudinaryEnabled,
  uploadPdfToCloudinary,
} from '../../config/cloudinary.config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  transliterateName,
  translateBranch,
  translateDesignation,
} from '../../common/urdu-identity';
import { AccessScopeService } from '../permissions/access-scope.service';
import { normalizePakistanPhone } from '../whatsapp/phone.util';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import {
  GenerateLetterDto,
  LetterQueryDto,
  PreviewLetterDto,
} from './letters.dto';
import {
  CreateLetterTemplateDto,
  PreviewLetterTemplateDto,
  UpdateLetterTemplateDto,
} from './letter-templates.dto';
import {
  DEFAULT_SENDER_TITLE,
  LETTER_TYPE_EN_HEADER,
  buildLetterRef,
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
  LetterType.EXPLANATION_FINE,
  LetterType.APPOINTMENT,
];

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

  async listTemplates(includeInactive = false) {
    return this.prisma.letterTemplate.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        requiredVars: true,
        fieldsSchema: true,
        primaryLanguage: true,
        isCustom: true,
        version: true,
        active: true,
        updatedAt: true,
      },
    });
  }

  async getTemplate(code: string) {
    const template = await this.prisma.letterTemplate.findUnique({
      where: { code },
    });
    if (!template) {
      throw new NotFoundException(`Letter template ${code} not found`);
    }
    return template;
  }

  async createTemplate(dto: CreateLetterTemplateDto, actingUserId: string) {
    const existing = await this.prisma.letterTemplate.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new BadRequestException(`Template code ${dto.code} already exists`);
    }

    const template = await this.prisma.letterTemplate.create({
      data: {
        code: dto.code,
        name: dto.name,
        bodyHtml: dto.bodyHtml,
        bodyHtmlEn: dto.bodyHtmlEn,
        subjectUr: dto.subjectUr,
        subjectEn: dto.subjectEn,
        enTitle: dto.enTitle,
        enPrescribed: dto.enPrescribed,
        enSubtitle: dto.enSubtitle,
        letterCode: dto.letterCode,
        primaryLanguage: dto.primaryLanguage ?? 'ur',
        fieldsSchema: (dto.fieldsSchema ?? []) as unknown as Prisma.InputJsonValue,
        requiredVars: dto.requiredVars ?? [],
        isCustom: true,
        version: 1,
        active: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actingUserId,
        action: 'LETTER_TEMPLATE_CREATED',
        entity: 'LetterTemplate',
        entityId: template.id,
        changes: { code: template.code, name: template.name },
      },
    });

    return template;
  }

  async updateTemplate(
    code: string,
    dto: UpdateLetterTemplateDto,
    actingUserId: string,
  ) {
    const existing = await this.getTemplate(code);

    if (dto.active === false && !existing.isCustom) {
      throw new BadRequestException(
        'Built-in letter types cannot be deactivated',
      );
    }

    const template = await this.prisma.letterTemplate.update({
      where: { code },
      data: {
        name: dto.name,
        bodyHtml: dto.bodyHtml,
        bodyHtmlEn: dto.bodyHtmlEn,
        subjectUr: dto.subjectUr,
        subjectEn: dto.subjectEn,
        enTitle: dto.enTitle,
        enPrescribed: dto.enPrescribed,
        enSubtitle: dto.enSubtitle,
        letterCode: dto.letterCode,
        primaryLanguage: dto.primaryLanguage,
        fieldsSchema:
          dto.fieldsSchema !== undefined
            ? (dto.fieldsSchema as unknown as Prisma.InputJsonValue)
            : undefined,
        requiredVars: dto.requiredVars,
        active: dto.active,
        version: { increment: 1 },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actingUserId,
        action: 'LETTER_TEMPLATE_UPDATED',
        entity: 'LetterTemplate',
        entityId: template.id,
        changes: { code: template.code, version: template.version },
      },
    });

    return template;
  }

  async deleteTemplate(code: string, actingUserId: string) {
    const existing = await this.getTemplate(code);
    if (!existing.isCustom) {
      throw new BadRequestException(
        'Built-in letter types cannot be deleted',
      );
    }

    const template = await this.prisma.letterTemplate.update({
      where: { code },
      data: { active: false },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actingUserId,
        action: 'LETTER_TEMPLATE_DELETED',
        entity: 'LetterTemplate',
        entityId: template.id,
        changes: { code: template.code },
      },
    });

    return template;
  }

  previewTemplateDraft(dto: PreviewLetterTemplateDto) {
    const sampleVariables: Record<string, unknown> = {
      letterNo: 'PREVIEW/YCDO/0000',
      letterRef: 'HRMS/GEN/000',
      issueDate: formatIssueDatePkt(),
      subject: 'نمونہ عنوان / Sample Subject',
      enTitle: 'LETTER OF SAMPLE',
      employeeName: 'محمد نمونہ ملازم',
      designation: 'نمونہ عہدہ',
      branch: 'نمونہ برانچ',
      employeeCode: 'SAMPLE-001',
      ...dto.variables,
    };
    return {
      previewHtml: renderLetterHtml(dto.bodyHtml, sampleVariables),
    };
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
      dto.templateCode,
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
          templateCode: SELECTION_TEMPLATE_CODE,
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

  private async generateTemplatedLetter(
    dto: GenerateLetterDto,
    actingUserId: string,
  ) {
    await this.buildTemplatedLetterHtml(
      dto.employeeId,
      dto.letterType,
      dto.extraFields ?? {},
      'PENDING',
      dto.templateCode,
    );

    const letterNo = await this.nextLetterNo();
    const built = await this.buildTemplatedLetterHtml(
      dto.employeeId,
      dto.letterType,
      dto.extraFields ?? {},
      letterNo,
      dto.templateCode,
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
          templateCode: built.templateCode,
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

      const letterLabel =
        dto.letterType === LetterType.CUSTOM
          ? built.templateName
          : dto.letterType.replace(/_/g, ' ');

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'LETTER_ISSUED',
          message: `A ${letterLabel} letter (${letterNo}) has been issued to you.`,
        },
      });

      return record;
    });

    await this.whatsappService.deliverAfterLetterGenerated({
      letterId: letter.id,
      employeeId: dto.employeeId,
      employeeName: String(built.variables.employeeName ?? ''),
      letterType: dto.letterType,
      phone: built.phone,
      fileUrl,
      pdfBuffer,
      filename: `${sanitizeRefForFilename(letterNo)}.pdf`,
    });

    return { letter, previewHtml: built.htmlContent };
  }

  private async buildTemplatedLetterHtml(
    employeeId: string,
    letterType: LetterType,
    extraFields: Record<string, unknown>,
    letterNo: string,
    templateCodeOverride?: string,
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

    if (letterType === LetterType.CUSTOM && !templateCodeOverride) {
      throw new BadRequestException(
        'templateCode is required for CUSTOM letters',
      );
    }

    const code =
      letterType === LetterType.CUSTOM
        ? templateCodeOverride!
        : templateCodeForLetterType(letterType);
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

    const enHeaderFallback =
      letterType !== LetterType.APPOINTMENT && letterType !== LetterType.CUSTOM
        ? LETTER_TYPE_EN_HEADER[letterType]
        : null;

    // Templates authored/edited via the Letter Templates admin UI carry their
    // own header/subject/short-code/language on the row; built-in types that
    // haven't been touched there fall back to the original hardcoded maps.
    const isEnglishLetterType = template.primaryLanguage === 'en';

    const variables: Record<string, unknown> = {
      letterNo,
      letterRef: buildLetterRef(letterType, letterNo, template.letterCode),
      issueDate:
        String(normalized.issueDate ?? '').trim() || formatIssueDatePkt(),
      senderTitle:
        String(normalized.senderTitle ?? '').trim() || DEFAULT_SENDER_TITLE,
      subject:
        String(normalized.subject ?? '').trim() ||
        template.subjectUr ||
        defaultSubjectFor(letterType) ||
        template.name,
      subjectLine: String(normalized.subjectLine ?? '').trim(),
      enTitle: template.enTitle ?? enHeaderFallback?.title ?? 'Notification',
      enPrescribed: template.enPrescribed ?? enHeaderFallback?.prescribed ?? '',
      enSubtitle: template.enSubtitle ?? enHeaderFallback?.subtitle ?? '',
      employeeCode: employee.employeeCode,
      cnic: employee.cnic ?? '',
      joiningDate: employee.joiningDate
        ? this.formatDate(employee.joiningDate)
        : '',
      ...normalized,
      // Prefer HR-typed overrides (set after spread so they win over empties).
      // Urdu letter types get an auto-transliterated/translated fallback from
      // the (English) employee record; TRANSFER/SALARY_INCREMENT stay English.
      employeeName:
        String(normalized.employeeName ?? '').trim() ||
        (isEnglishLetterType
          ? employee.fullName
          : transliterateName(employee.fullName)),
      designation:
        String(normalized.designation ?? '').trim() ||
        (isEnglishLetterType
          ? employee.currentDesignation ?? ''
          : translateDesignation(employee.currentDesignation)),
      department:
        String(normalized.department ?? '').trim() ||
        employee.currentDepartment?.name ||
        '',
      branch:
        String(normalized.branch ?? '').trim() ||
        (isEnglishLetterType
          ? employee.currentBranch?.name ?? ''
          : translateBranch(employee.currentBranch?.name)),
      violations: parseViolationLines(
        normalized.violations ?? normalized.warningReason,
      ),
      attendanceRows: parseAttendanceRows(normalized.attendanceRows),
      incrementAmount: String(incrementAmount),
      timing: String(normalized.timing ?? '').trim() || 'ڈیوٹی روسترکے مطابق',
    };

    const renderBody =
      template.primaryLanguage === 'en' && template.bodyHtmlEn
        ? template.bodyHtmlEn
        : template.bodyHtml;
    const htmlContent = renderLetterHtml(renderBody, variables);

    return {
      htmlContent,
      variables,
      templateVersion: template.version,
      templateCode: template.code,
      templateName: template.name,
      phone: employee.phone,
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
    if (letterType === LetterType.SALARY_INCREMENT) {
      if (!out.incrementAmount && out.previousSalary && out.newSalary) {
        out.incrementAmount = String(
          Number(out.newSalary) - Number(out.previousSalary),
        );
      }
    }
    if (letterType === LetterType.FINE && out.finePreset) {
      const FINE_PRESET_LABELS: Record<string, string> = {
        ABSENT: 'بغیر اطلاع و اجازت چھٹی',
        LATE_DEDUCTION: 'مسلسل ڈیوٹی پر لیٹ آنا',
        UNIFORM: 'یونیفارم کی خلاف ورزی',
        ELECTRICITY: 'بجلی کا ضرورت سے زیادہ استعمال',
      };
      out.isFineAbsent = out.finePreset === 'ABSENT';
      out.isFineLate = out.finePreset === 'LATE_DEDUCTION';
      out.isFineUniform = out.finePreset === 'UNIFORM';
      out.isFineElectricity = out.finePreset === 'ELECTRICITY';
      if (!out.fineReason) {
        out.fineReason = FINE_PRESET_LABELS[String(out.finePreset)] ?? '';
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
      try {
        return await uploadPdfToCloudinary(pdfBuffer, publicId, 'letters');
      } catch (err) {
        // Fall back to local disk so download/regenerate still works.
        console.error('Cloudinary letter upload failed; using local uploads:', err);
      }
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

  /**
   * Letters awaiting HR outbound WhatsApp Web share (wa.me).
   * Excludes Meta SENT / in-flight PENDING sends and already-shared rows.
   */
  async findPending(
    actingUser?: { id: string; role: UserRole },
  ) {
    const where: Prisma.LetterWhereInput = {
      whatsappSharedAt: null,
      OR: [
        { whatsappSend: null },
        {
          whatsappSend: {
            status: {
              in: [WhatsAppSendStatus.FAILED, WhatsAppSendStatus.SKIPPED],
            },
          },
        },
      ],
    };

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
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            phone: true,
          },
        },
        whatsappSend: {
          select: {
            status: true,
            error: true,
            attempts: true,
            lastTriedAt: true,
          },
        },
      },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async getWhatsAppShare(letterId: string) {
    const letter = await this.prisma.letter.findUnique({
      where: { id: letterId },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            phone: true,
          },
        },
      },
    });

    if (!letter) {
      throw new NotFoundException(`Letter with id ${letterId} not found`);
    }

    const phoneE164 = normalizePakistanPhone(letter.employee.phone);
    const letterTypeLabel = letter.letterType.replace(/_/g, ' ');
    const ref = letter.letterNo ?? letter.id.slice(0, 8);
    const portalBase =
      process.env.PUBLIC_PORTAL_URL?.replace(/\/$/, '') || '';
    const portalHint = portalBase
      ? `\n\nYou can also view this letter in the employee portal: ${portalBase}`
      : '\n\nYou can also view this letter in the employee portal.';

    const message =
      `Assalam o Alaikum ${letter.employee.fullName},\n\n` +
      `Please find your ${letterTypeLabel} letter (${ref}). ` +
      `The PDF is attached in this chat — please download and review it.` +
      portalHint +
      `\n\n— YCDO HR`;

    const encoded = encodeURIComponent(message);
    const waUrl = phoneE164
      ? `https://wa.me/${phoneE164}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;

    const filename = `${sanitizeRefForFilename(String(ref))}.pdf`;

    return {
      letterId: letter.id,
      phoneE164: phoneE164 ?? null,
      phoneConfigured: Boolean(phoneE164),
      waUrl,
      message,
      filename,
      employee: letter.employee,
      letterType: letter.letterType,
      letterNo: letter.letterNo,
    };
  }

  async markWhatsAppShared(letterId: string) {
    await this.findOne(letterId);

    return this.prisma.letter.update({
      where: { id: letterId },
      data: {
        whatsappSharedAt: new Date(),
        whatsappShareChannel: 'WA_ME',
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            phone: true,
          },
        },
      },
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

    // Prefer existing file when present on disk / Cloudinary.
    if (letter.fileUrl) {
      try {
        return await this.loadExistingPdf(letter);
      } catch {
        // Fall through to regenerate from stored template variables.
      }
    }

    const repaired = await this.regeneratePdfForLetter(letter);
    if (repaired) {
      return repaired;
    }

    throw new NotFoundException(
      'File unavailable — please reissue this letter',
    );
  }

  private async loadExistingPdf(letter: {
    id: string;
    letterNo: string | null;
    fileUrl: string | null;
  }): Promise<{ buffer: Buffer; filename: string }> {
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

  /**
   * Rebuild PDF from stored Handlebars variables when the file was lost
   * (ephemeral Docker disk, multi-instance, failed Cloudinary fetch, etc.).
   */
  private async regeneratePdfForLetter(letter: {
    id: string;
    employeeId: string;
    letterType: LetterType;
    letterNo: string | null;
    variables: Prisma.JsonValue | null;
    content: Prisma.JsonValue;
  }): Promise<{ buffer: Buffer; filename: string } | null> {
    const storedVars =
      letter.variables &&
      typeof letter.variables === 'object' &&
      !Array.isArray(letter.variables)
        ? (letter.variables as Record<string, unknown>)
        : null;

    const content =
      letter.content &&
      typeof letter.content === 'object' &&
      !Array.isArray(letter.content)
        ? (letter.content as Record<string, unknown>)
        : {};

    const letterNo =
      letter.letterNo ??
      storedVars?.letterNo?.toString() ??
      `REISSUE-${letter.id.slice(0, 8)}`;

    try {
      let htmlContent: string;

      if (letter.letterType === LetterType.APPOINTMENT) {
        const template = await this.prisma.letterTemplate.findFirst({
          where: { code: SELECTION_TEMPLATE_CODE, active: true },
        });
        if (!template || !storedVars) return null;
        htmlContent = renderHandlebarsTemplate(template.bodyHtml, {
          ...storedVars,
          letterNo: String(letterNo),
        } as SelectionLetterVariables);
      } else {
        const code = templateCodeForLetterType(letter.letterType);
        const template = await this.prisma.letterTemplate.findFirst({
          where: { code, active: true },
        });
        if (!template) return null;

        const merged: Record<string, unknown> = {
          ...content,
          ...(storedVars ?? {}),
          letterNo: String(letterNo),
        };

        // Ensure list fields are real arrays for Handlebars.
        merged.violations = parseViolationLines(
          merged.violations ?? merged.warningReason,
        );
        merged.attendanceRows = parseAttendanceRows(merged.attendanceRows);

        if (!merged.issueDate) {
          merged.issueDate = formatIssueDatePkt();
        }
        if (!merged.subject) {
          merged.subject = defaultSubjectFor(letter.letterType);
        }
        if (!merged.senderTitle) {
          merged.senderTitle = DEFAULT_SENDER_TITLE;
        }
        if (!merged.letterRef) {
          merged.letterRef = buildLetterRef(
            letter.letterType,
            String(letterNo),
          );
        }
        const enHeader = LETTER_TYPE_EN_HEADER[letter.letterType];
        merged.enTitle = merged.enTitle ?? enHeader.title;
        merged.enPrescribed = merged.enPrescribed ?? enHeader.prescribed;
        merged.enSubtitle = merged.enSubtitle ?? enHeader.subtitle;

        htmlContent = renderLetterHtml(template.bodyHtml, merged);
      }

      const pdfBuffer = await generatePdf(htmlContent);
      const fileUrl = await this.persistPdf(
        pdfBuffer,
        String(letterNo),
        letter.employeeId,
      );

      await this.prisma.letter.update({
        where: { id: letter.id },
        data: { fileUrl },
      });

      const filename = `${sanitizeRefForFilename(String(letterNo))}.pdf`;
      return { buffer: pdfBuffer, filename };
    } catch (err) {
      console.error(`Failed to regenerate PDF for letter ${letter.id}:`, err);
      return null;
    }
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
