import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentLetterLanguage,
  DeductionType,
  DisciplinaryStatus,
  DisciplinaryType,
  Gender,
  EmployeeStatus,
  LetterStatus,
  LetterType,
  PayrollStatus,
  Permission,
  Prisma,
  SuspensionRequestStatus,
  UserRole,
  WhatsAppSendStatus,
} from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  isCloudinaryEnabled,
  uploadPdfToCloudinary,
} from '../../config/cloudinary.config';
import { hasAnyRole } from '../../common/user-roles.util';
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
  ensureInquiryResolvedNotification,
  isResolutionTriggerKind,
  letterContentStamps,
} from '../disciplinary/inquiry-final-letters';
import { applyDisciplineDeductionOnLetterSend } from '../attendance/discipline.helper';
import {
  GenerateLetterDto,
  LetterQueryDto,
  PreviewLetterDto,
  ReverseLetterDto,
  UpdateLetterDto,
  AppointmentPreviewDto,
} from './letters.dto';
import {
  CreateLetterTemplateDto,
  PreviewLetterTemplateDto,
  UpdateLetterTemplateDto,
} from './letter-templates.dto';
import {
  DEFAULT_SENDER_TITLE,
  LETTER_TYPE_EN_HEADER,
  appendComputerGeneratedNotice,
  applyFineUniformWording,
  buildLetterRef,
  defaultSubjectFor,
  parseAttendanceRows,
  parseViolationLines,
  renderLetterHtml,
  sanitizeRefForFilename,
  templateCodeForLetterType,
} from './letter-templates.helper';
import { generatePdf } from './pdf.helper';
import { APPOINTMENT_CHAIRMAN_ADMIN_NAME } from './appointment-signatory';
import { resolveAppointmentTemplateMapping } from './appointment-template-mapping';
import { resolveAppointmentServiceArea } from './appointment-families';
import { appointmentSopHtml } from './appointment-sop';
import {
  resolveAppointmentDutyTotalHours,
  resolveAppointmentMonthlyAllowedLeaves,
  shortLeaveHoursFromDutyTotalHours,
} from './appointment-policy';
import { URDU_LETTER_STYLES } from './urdu-letter-styles';
import {
  assertAppointmentSnapshotReady,
  assertAppointmentVariablesRenderable,
} from './appointment-validation';
import { isInvalidAppointmentAssignment } from './appointment-families';
import { APPOINTMENT_INVALID_ASSIGNMENT_MESSAGE } from './appointment-families';
import {
  applyAppointmentDraftWatermark,
  stripAppointmentDraftWatermark,
} from './appointment-watermark';
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

/** System watchlist notices: auto SENT; not creatable from Generate Letter. */
const SYSTEM_GENERATED_LETTER_TYPES: LetterType[] = [
  LetterType.SUSPENSION_ELIGIBILITY,
  LetterType.NEAR_SUSPENSION_WARNING,
];

function isSystemGeneratedLetterType(letterType: LetterType): boolean {
  return SYSTEM_GENERATED_LETTER_TYPES.includes(letterType);
}

function letterIssuedAuditAction(letterType: LetterType): string {
  if (letterType === LetterType.SUSPENSION_ELIGIBILITY) {
    return 'SUSPENSION_ELIGIBILITY_NOTICE_ISSUED';
  }
  if (letterType === LetterType.NEAR_SUSPENSION_WARNING) {
    return 'NEAR_SUSPENSION_WARNING_ISSUED';
  }
  return 'LETTER_GENERATED';
}

/** Discipline letters that stay DRAFT until HR explicitly sends to portal. */
const DRAFT_UNTIL_SEND_TYPES: LetterType[] = [
  LetterType.ADVICE,
  LetterType.WARNING,
  LetterType.FINE,
  LetterType.EXPLANATION,
  LetterType.SUSPENSION,
  LetterType.REINSTATEMENT,
  LetterType.TERMINATION,
  LetterType.APPOINTMENT,
];

/** Pre-send Appointment lifecycle (watermarked; not on the employee portal). */
const APPOINTMENT_OPEN_STATUSES: LetterStatus[] = [
  LetterStatus.DRAFT,
  LetterStatus.PENDING_APPROVAL,
  LetterStatus.APPROVED,
];

export const APPOINTMENT_APPROVER_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.PRESIDENT,
  UserRole.FOUNDER,
  UserRole.CHAIRMAN,
];

export const APPOINTMENT_SEND_REQUIRES_APPROVAL_MESSAGE =
  'Appointment letter must be approved before it can be sent.';

/** Employment states that must not be overwritten by sending a suspension letter. */
const TERMINAL_EMPLOYEE_STATUSES: EmployeeStatus[] = [
  EmployeeStatus.TERMINATED,
  EmployeeStatus.DISMISSED,
  EmployeeStatus.RESIGNED,
];

const SUSPENSION_REQUEST_ON_LETTER = {
  select: {
    id: true,
    status: true,
    periodStart: true,
    periodEnd: true,
    inquiryDeadlineAt: true,
    inquiryOfficer: {
      select: {
        id: true,
        email: true,
        employee: { select: { fullName: true } },
      },
    },
  },
} as const;

const ACKNOWLEDGEMENT_TYPES: LetterType[] = [
  LetterType.ADVICE,
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

    if (isSystemGeneratedLetterType(dto.letterType)) {
      throw new BadRequestException(
        'This letter type is system-generated and cannot be created from Generate Letter',
      );
    }

    if (dto.letterType === LetterType.APPOINTMENT) {
      const { htmlContent, variables, mapping } =
        await this.buildSelectionLetterHtml(
          dto.employeeId,
          dto.extraFields ?? {},
          { letterNo: 'PREVIEW/YCDO/0000', draft: true },
        );
      return { previewHtml: htmlContent, variables, mapping };
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

  async previewAppointment(
    dto: AppointmentPreviewDto,
    _actingUserId: string,
    _actingRole: UserRole,
  ) {
    const { htmlContent, variables, mapping } =
      await this.buildAppointmentHtmlFromSnapshot(
        {
          fullName: dto.fullName,
          cnic: dto.cnic?.trim() || 'N/A',
          phone: dto.phone,
          gender: (dto.gender as Gender) ?? Gender.MALE,
          currentDepartmentId: dto.currentDepartmentId,
          currentDesignation: dto.currentDesignation,
          branchName: dto.branchName ?? '',
          dutyStartTime: dto.dutyStartTime ?? null,
          dutyEndTime: dto.dutyEndTime ?? null,
          monthlyAllowedLeaves:
            typeof dto.extraFields?.monthlyAllowedLeaves === 'number'
              ? dto.extraFields.monthlyAllowedLeaves
              : dto.extraFields?.monthlyAllowedLeaves != null
                ? Number(dto.extraFields.monthlyAllowedLeaves)
                : null,
          dutyTotalHours:
            dto.extraFields?.dutyTotalHours != null
              ? Number(dto.extraFields.dutyTotalHours)
              : dto.extraFields?.hoursPerDay != null
                ? Number(dto.extraFields.hoursPerDay)
                : null,
        },
        dto.extraFields ?? {},
        { letterNo: 'PREVIEW/YCDO/0000', draft: true },
      );

    return { previewHtml: htmlContent, variables, mapping };
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

    if (isSystemGeneratedLetterType(dto.letterType)) {
      throw new BadRequestException(
        'This letter type is system-generated and cannot be created from Generate Letter',
      );
    }

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
    const existingDraft = await this.prisma.letter.findFirst({
      where: {
        employeeId: dto.employeeId,
        letterType: LetterType.APPOINTMENT,
        status: { in: APPOINTMENT_OPEN_STATUSES },
      },
    });
    if (existingDraft) {
      const prepared = await this.buildSelectionLetterHtml(
        dto.employeeId,
        {
          ...((existingDraft.content as Record<string, unknown>) ?? {}),
        },
        { letterNo: existingDraft.letterNo ?? 'PENDING', draft: true },
      );
      return {
        letter: existingDraft,
        previewHtml: prepared.htmlContent,
        reusedExisting: true,
      };
    }

    const prepared = await this.buildSelectionLetterHtml(
      dto.employeeId,
      dto.extraFields ?? {},
      { letterNo: 'PENDING', draft: true },
    );

    const letterNo = await this.nextLetterNo();
    const variables: SelectionLetterVariables = {
      ...prepared.variables,
      letterNo,
    };
    const htmlContent = applyAppointmentDraftWatermark(
      renderHandlebarsTemplate(prepared.bodyHtml, variables),
    );
    const pdfBuffer = await generatePdf(htmlContent);
    const fileUrl = await this.persistPdf(
      pdfBuffer,
      letterNo,
      dto.employeeId,
    );

    try {
      const letter = await this.prisma.$transaction(async (tx) => {
        const record = await tx.letter.create({
          data: {
            employeeId: dto.employeeId,
            letterType: LetterType.APPOINTMENT,
            status: LetterStatus.DRAFT,
            templateCode: prepared.templateCode,
            content: (dto.extraFields ?? {}) as Prisma.InputJsonValue,
            fileUrl,
            letterNo,
            variables: variables as Prisma.InputJsonValue,
            templateVersion: prepared.templateVersion,
            requiresAcknowledgement: false,
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
                status: LetterStatus.DRAFT,
                mappingId: prepared.mapping.mappingId,
              },
            },
          });
        }

        return record;
      });

      return { letter, previewHtml: htmlContent, reusedExisting: false };
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: string }).code)
          : '';
      if (code === 'P2002') {
        const raced = await this.prisma.letter.findFirst({
          where: {
            employeeId: dto.employeeId,
            letterType: LetterType.APPOINTMENT,
            status: { in: APPOINTMENT_OPEN_STATUSES },
          },
        });
        if (raced) {
          return { letter: raced, previewHtml: htmlContent, reusedExisting: true };
        }
      }
      throw err;
    }
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

    const deferPortal = DRAFT_UNTIL_SEND_TYPES.includes(dto.letterType);
    const status = deferPortal ? LetterStatus.DRAFT : LetterStatus.SENT;

    const letter = await this.prisma.$transaction(async (tx) => {
      const record = await tx.letter.create({
        data: {
          employeeId: dto.employeeId,
          letterType: dto.letterType,
          status,
          templateCode: built.templateCode,
          content: (dto.extraFields ?? {}) as Prisma.InputJsonValue,
          fileUrl,
          letterNo,
          variables: built.variables as Prisma.InputJsonValue,
          templateVersion: built.templateVersion,
          replyDeadline: deferPortal ? undefined : replyDeadline,
          requiresAcknowledgement: deferPortal
            ? false
            : ACKNOWLEDGEMENT_TYPES.includes(dto.letterType),
        },
      });

      const auditUserId = await this.resolveLetterAuditUserId(
        tx,
        actingUserId,
        dto.letterType,
      );
      if (auditUserId) {
        await tx.auditLog.create({
          data: {
            userId: auditUserId,
            action: letterIssuedAuditAction(dto.letterType),
            entity: 'Letter',
            entityId: record.id,
            changes: {
              letterType: dto.letterType,
              letterNo,
              status,
            },
          },
        });
      }

      if (!deferPortal) {
        await tx.notification.create({
          data: {
            employeeId: dto.employeeId,
            type: 'LETTER_ISSUED',
            message: this.issuedLetterNotificationMessage(
              dto.letterType,
              letterNo,
              built.templateName,
            ),
          },
        });
      }

      return record;
    });

    if (!deferPortal) {
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
    }

    return { letter, previewHtml: built.htmlContent, reusedExisting: false };
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

    if (template.code === 'FINE') {
      const fixedBody = applyFineUniformWording(template.bodyHtml);
      if (fixedBody !== template.bodyHtml) {
        await this.prisma.letterTemplate.update({
          where: { id: template.id },
          data: {
            bodyHtml: fixedBody,
            version: { increment: 1 },
          },
        });
        template.bodyHtml = fixedBody;
        template.version += 1;
      }
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
      letterNo,
      letterRef: buildLetterRef(letterType, letterNo, template.letterCode),
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

  private issuedLetterNotificationMessage(
    letterType: LetterType,
    letterNo: string,
    templateName: string,
  ): string {
    if (letterType === LetterType.SUSPENSION_ELIGIBILITY) {
      return `A pre-suspension eligibility notice (اہلیت برائے معطلی, ${letterNo}) has been issued to you. This is not a suspension letter and you have not been suspended.`;
    }
    if (letterType === LetterType.NEAR_SUSPENSION_WARNING) {
      return `A warning notice of approaching suspension (تنبیہی نوٹس برائے ممکنہ معطلی, ${letterNo}) has been issued to you. This is not a suspension letter and you have not been suspended.`;
    }
    const letterLabel =
      letterType === LetterType.CUSTOM
        ? templateName
        : letterType.replace(/_/g, ' ');
    return `A ${letterLabel} letter (${letterNo}) has been issued to you.`;
  }

  private async resolveLetterAuditUserId(
    tx: Prisma.TransactionClient,
    actingUserId: string,
    letterType: LetterType,
  ): Promise<string | null> {
    if (actingUserId !== 'SYSTEM') return actingUserId;
    if (!isSystemGeneratedLetterType(letterType)) return null;

    const actor = await tx.user.findFirst({
      where: {
        isActive: true,
        role: {
          in: [
            UserRole.HR_MANAGER,
            UserRole.HR_ADMIN_MANAGER,
            UserRole.SUPER_ADMIN,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return actor?.id ?? null;
  }

  private async buildSelectionLetterHtml(
    employeeId: string,
    extraFields: Record<string, unknown>,
    opts: { letterNo: string; draft: boolean },
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        currentBranch: { select: { name: true } },
        currentDepartment: { select: { id: true, name: true } },
        shift: { select: { name: true } },
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

    return this.buildAppointmentHtmlFromSnapshot(
      {
        fullName: employee.fullName,
        cnic: employee.cnic!,
        phone: employee.phone!,
        gender: employee.gender,
        currentDepartmentId: employee.currentDepartmentId,
        currentDesignation: employee.currentDesignation!,
        branchName: employee.currentBranch!.name,
        dutyStartTime: employee.dutyStartTime,
        dutyEndTime: employee.dutyEndTime,
        departmentName: employee.currentDepartment!.name,
        monthlyAllowedLeaves: employee.monthlyAllowedLeaves,
        dutyTotalHours: employee.dutyTotalHours,
        shiftName: employee.shift?.name ?? null,
      },
      extraFields,
      opts,
    );
  }

  private async buildAppointmentHtmlFromSnapshot(
    snapshot: {
      fullName: string;
      cnic: string;
      phone: string;
      gender: Gender;
      currentDepartmentId: string;
      currentDesignation: string;
      branchName: string;
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
      departmentName?: string;
      monthlyAllowedLeaves?: number | null;
      dutyTotalHours?: number | null;
      shiftName?: string | null;
    },
    extraFields: Record<string, unknown>,
    opts: { letterNo: string; draft: boolean },
  ) {
    const mapping = await resolveAppointmentTemplateMapping(this.prisma, {
      departmentId: snapshot.currentDepartmentId,
      designationTitle: snapshot.currentDesignation,
    });

    const template = await this.prisma.letterTemplate.findFirst({
      where: { code: mapping.templateCode, active: true },
    });

    if (!template) {
      throw new NotFoundException(
        `Appointment template ${mapping.templateCode} is not seeded.`,
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

    const departmentName =
      snapshot.departmentName ??
      (
        await this.prisma.department.findUnique({
          where: { id: snapshot.currentDepartmentId },
          select: { name: true },
        })
      )?.name ??
      '';

    if (
      isInvalidAppointmentAssignment(
        departmentName,
        snapshot.currentDesignation,
      )
    ) {
      throw new BadRequestException(APPOINTMENT_INVALID_ASSIGNMENT_MESSAGE);
    }

    const schedule = scheduleFromDuty({
      dutyStartTime: snapshot.dutyStartTime,
      dutyEndTime: snapshot.dutyEndTime,
    });

    const dutyTotalHours = resolveAppointmentDutyTotalHours({
      employeeDutyTotalHours: snapshot.dutyTotalHours,
      extraFields,
    });
    const monthlyAllowedLeaves = resolveAppointmentMonthlyAllowedLeaves({
      employeeMonthlyAllowedLeaves: snapshot.monthlyAllowedLeaves,
      extraFields,
    });
    const shortLeaveHours = shortLeaveHoursFromDutyTotalHours(dutyTotalHours);
    const serviceArea = resolveAppointmentServiceArea(
      mapping.templateCode,
      departmentName,
    );
    const departmentSpecificSops = appointmentSopHtml(
      mapping.templateCode,
      mapping.language,
    );
    const shiftName =
      String(extraFields.shiftName ?? snapshot.shiftName ?? '').trim() ||
      'General';

    const variables: SelectionLetterVariables = {
      ...buildOrgVariables(),
      letterNo: opts.letterNo,
      issueDate: formatIssueDatePkt(),
      salutation: salutationFromGender(snapshot.gender),
      employeeName: snapshot.fullName,
      cnic: snapshot.cnic,
      phone: snapshot.phone,
      designation: snapshot.currentDesignation,
      department: departmentName,
      branchName: snapshot.branchName,
      scheduleFrom: schedule.scheduleFrom,
      scheduleTo: schedule.scheduleTo,
      stipendAmount: String(extraFields.stipendAmount ?? '').trim(),
      hoursPerDay: String(dutyTotalHours),
      dutyTotalHours: String(dutyTotalHours),
      shiftName,
      capacity: String(extraFields.capacity ?? '').trim(),
      monthlyAllowedLeaves: String(monthlyAllowedLeaves),
      shortLeaveHours,
      serviceArea,
      departmentSpecificSops,
      digitalAcceptance: false,
      chairmanAdminName: APPOINTMENT_CHAIRMAN_ADMIN_NAME,
      appointmentLanguage: mapping.language,
      mappingMatch: mapping.match,
      letterStyles:
        mapping.language === AppointmentLetterLanguage.UR
          ? URDU_LETTER_STYLES
          : '',
    };

    assertAppointmentSnapshotReady({
      fullName: snapshot.fullName,
      departmentName,
      designation: snapshot.currentDesignation,
      branchName: snapshot.branchName,
      stipendAmount: String(extraFields.stipendAmount ?? ''),
      dutyTotalHours,
      scheduleFrom: schedule.scheduleFrom,
      scheduleTo: schedule.scheduleTo,
    });
    assertAppointmentVariablesRenderable(variables);

    const bodyHtml =
      mapping.language === AppointmentLetterLanguage.EN && template.bodyHtmlEn
        ? template.bodyHtmlEn
        : template.bodyHtml;

    let htmlContent = appendComputerGeneratedNotice(
      renderHandlebarsTemplate(bodyHtml, variables),
    );
    if (opts.draft) {
      htmlContent = applyAppointmentDraftWatermark(htmlContent);
    } else {
      htmlContent = stripAppointmentDraftWatermark(htmlContent);
    }

    return {
      htmlContent,
      variables,
      bodyHtml,
      templateVersion: template.version,
      templateCode: template.code,
      phone: snapshot.phone,
      mapping,
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

  async updateLetter(
    letterId: string,
    dto: UpdateLetterDto,
    actingUserId: string,
    actingRole: UserRole,
  ) {
    const letter = await this.findOne(letterId);
    await this.accessScopeService.assertEmployeeAccess(
      actingUserId,
      actingRole,
      Permission.LETTERS_GENERATE,
      letter.employeeId,
    );

    if (letter.status !== LetterStatus.DRAFT) {
      throw new BadRequestException(
        letter.status === LetterStatus.REVERSED
          ? 'Cannot edit a reversed letter'
          : 'Only draft letters can be edited',
      );
    }

    const linkedRequest = await this.prisma.suspensionRequest.findUnique({
      where: { letterId },
      select: { status: true },
    });
    if (
      linkedRequest?.status === SuspensionRequestStatus.PENDING_APPROVAL ||
      linkedRequest?.status === SuspensionRequestStatus.APPROVED
    ) {
      throw new BadRequestException(
        'This suspension letter cannot be edited while the suspension request is pending approval or approved.',
      );
    }
    if (linkedRequest?.status === SuspensionRequestStatus.CANCELLED) {
      throw new BadRequestException(
        'This suspension letter cannot be edited because the suspension request was cancelled.',
      );
    }

    const extraFields = {
      ...((letter.content as Record<string, unknown>) ?? {}),
      ...(dto.extraFields ?? {}),
    };

    const letterNo = letter.letterNo ?? (await this.nextLetterNo());
    const built =
      letter.letterType === LetterType.APPOINTMENT
        ? await this.buildSelectionLetterHtml(
            letter.employeeId,
            extraFields,
            { letterNo, draft: true },
          )
        : await this.buildTemplatedLetterHtml(
            letter.employeeId,
            letter.letterType,
            extraFields,
            letterNo,
            dto.templateCode ?? letter.templateCode ?? undefined,
          );
    const pdfBuffer = await generatePdf(built.htmlContent);
    const fileUrl = await this.persistPdf(
      pdfBuffer,
      letterNo,
      letter.employeeId,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.letter.update({
        where: { id: letterId },
        data: {
          content: extraFields as Prisma.InputJsonValue,
          variables: built.variables as Prisma.InputJsonValue,
          templateCode: built.templateCode,
          templateVersion: built.templateVersion,
          fileUrl,
          letterNo,
        },
        include: {
          employee: { select: { fullName: true, employeeCode: true } },
          acknowledgement: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'LETTER_UPDATED',
          entity: 'Letter',
          entityId: letterId,
          changes: { letterNo, status: letter.status },
        },
      });

      return record;
    });

    return { letter: updated, previewHtml: built.htmlContent };
  }

  async submitAppointmentForApproval(
    letterId: string,
    actingUserId: string,
    actingRole: UserRole,
  ) {
    const letter = await this.findOne(letterId);
    await this.accessScopeService.assertEmployeeAccess(
      actingUserId,
      actingRole,
      Permission.LETTERS_GENERATE,
      letter.employeeId,
    );
    this.assertAppointmentLetter(letter);

    if (letter.status !== LetterStatus.DRAFT) {
      throw new BadRequestException(
        letter.status === LetterStatus.PENDING_APPROVAL
          ? 'This appointment letter is already pending approval'
          : letter.status === LetterStatus.APPROVED
            ? 'This appointment letter is already approved'
            : 'Only a draft appointment letter can be submitted for approval',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.letter.updateMany({
        where: { id: letterId, status: LetterStatus.DRAFT },
        data: { status: LetterStatus.PENDING_APPROVAL },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'Only a draft appointment letter can be submitted for approval',
        );
      }
      const record = await tx.letter.findUnique({
        where: { id: letterId },
        include: {
          employee: { select: { fullName: true, employeeCode: true } },
          acknowledgement: true,
        },
      });
      if (!record) {
        throw new NotFoundException(`Letter with id ${letterId} not found`);
      }
      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'LETTER_SUBMITTED_FOR_APPROVAL',
          entity: 'Letter',
          entityId: letterId,
          changes: {
            letterNo: letter.letterNo,
            letterType: LetterType.APPOINTMENT,
            from: LetterStatus.DRAFT,
            to: LetterStatus.PENDING_APPROVAL,
          },
        },
      });
      return record;
    });

    return { letter: updated };
  }

  async approveAppointmentLetter(
    letterId: string,
    actingUserId: string,
    actingRole: UserRole,
  ) {
    this.assertAppointmentApprover(actingRole);
    const letter = await this.findOne(letterId);
    this.assertAppointmentLetter(letter);

    if (letter.status !== LetterStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only a pending appointment letter can be approved',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.letter.updateMany({
        where: { id: letterId, status: LetterStatus.PENDING_APPROVAL },
        data: { status: LetterStatus.APPROVED },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'Only a pending appointment letter can be approved',
        );
      }
      const record = await tx.letter.findUnique({
        where: { id: letterId },
        include: {
          employee: { select: { fullName: true, employeeCode: true } },
          acknowledgement: true,
        },
      });
      if (!record) {
        throw new NotFoundException(`Letter with id ${letterId} not found`);
      }
      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'LETTER_APPROVAL_APPROVED',
          entity: 'Letter',
          entityId: letterId,
          changes: {
            letterNo: letter.letterNo,
            letterType: LetterType.APPOINTMENT,
            from: LetterStatus.PENDING_APPROVAL,
            to: LetterStatus.APPROVED,
          },
        },
      });
      return record;
    });

    return { letter: updated };
  }

  async rejectAppointmentLetter(
    letterId: string,
    actingUserId: string,
    actingRole: UserRole,
    reason?: string,
  ) {
    this.assertAppointmentApprover(actingRole);
    const letter = await this.findOne(letterId);
    this.assertAppointmentLetter(letter);

    if (
      letter.status !== LetterStatus.PENDING_APPROVAL &&
      letter.status !== LetterStatus.APPROVED
    ) {
      throw new BadRequestException(
        'Only a pending or approved appointment letter can be returned for changes',
      );
    }

    const from = letter.status;
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.letter.updateMany({
        where: {
          id: letterId,
          status: {
            in: [LetterStatus.PENDING_APPROVAL, LetterStatus.APPROVED],
          },
        },
        data: { status: LetterStatus.DRAFT },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'Only a pending or approved appointment letter can be returned for changes',
        );
      }
      const record = await tx.letter.findUnique({
        where: { id: letterId },
        include: {
          employee: { select: { fullName: true, employeeCode: true } },
          acknowledgement: true,
        },
      });
      if (!record) {
        throw new NotFoundException(`Letter with id ${letterId} not found`);
      }
      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'LETTER_APPROVAL_REJECTED',
          entity: 'Letter',
          entityId: letterId,
          changes: {
            letterNo: letter.letterNo,
            letterType: LetterType.APPOINTMENT,
            from,
            to: LetterStatus.DRAFT,
            reason: reason?.trim() || null,
          },
        },
      });
      return record;
    });

    return { letter: updated };
  }

  async findPendingAppointmentApprovals() {
    return this.prisma.letter.findMany({
      where: {
        letterType: LetterType.APPOINTMENT,
        status: LetterStatus.PENDING_APPROVAL,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            currentDesignation: true,
            currentBranch: { select: { name: true, abbreviation: true } },
          },
        },
      },
      orderBy: { generatedAt: 'desc' },
    });
  }

  private assertAppointmentLetter(letter: {
    letterType: LetterType;
    status: LetterStatus;
  }) {
    if (letter.letterType !== LetterType.APPOINTMENT) {
      throw new BadRequestException(
        'This action is only available for Appointment letters',
      );
    }
  }

  private assertAppointmentApprover(actingRole: UserRole) {
    if (!hasAnyRole([actingRole], APPOINTMENT_APPROVER_ROLES)) {
      throw new ForbiddenException(
        'Only President, Founder, Chairman, or Super Admin can approve appointment letters',
      );
    }
  }

  async sendLetter(
    letterId: string,
    actingUserId: string,
    actingRole: UserRole,
  ) {
    const letter = await this.findOne(letterId);
    await this.accessScopeService.assertEmployeeAccess(
      actingUserId,
      actingRole,
      Permission.LETTERS_GENERATE,
      letter.employeeId,
    );

    if (letter.status === LetterStatus.REVERSED) {
      throw new BadRequestException('Cannot send a reversed letter');
    }
    if (letter.status === LetterStatus.SENT) {
      return {
        letter,
        alreadySent: true,
        message: 'Letter already sent to portal',
      };
    }
    if (
      letter.letterType === LetterType.APPOINTMENT &&
      letter.status !== LetterStatus.APPROVED
    ) {
      throw new BadRequestException(APPOINTMENT_SEND_REQUIRES_APPROVAL_MESSAGE);
    }

    const requiresAck = ACKNOWLEDGEMENT_TYPES.includes(letter.letterType);
    const replyDeadline =
      letter.letterType === LetterType.SHOW_CAUSE
        ? new Date(Date.now() + 48 * 60 * 60 * 1000)
        : letter.replyDeadline;

    const letterLabel =
      letter.letterType === LetterType.CUSTOM
        ? String(
            (letter.variables as Record<string, unknown> | null)?.templateName ??
              'Custom',
          )
        : letter.letterType.replace(/_/g, ' ');
    const letterNo = letter.letterNo ?? letterId.slice(0, 8);

    let appointmentSend: {
      fileUrl: string;
      variables: SelectionLetterVariables;
      templateCode: string;
      templateVersion: number;
    } | null = null;
    if (letter.letterType === LetterType.APPOINTMENT) {
      const extraFields = {
        ...((letter.content as Record<string, unknown>) ?? {}),
      };
      const built = await this.buildSelectionLetterHtml(
        letter.employeeId,
        extraFields,
        { letterNo, draft: false },
      );
      const pdfBuffer = await generatePdf(built.htmlContent);
      appointmentSend = {
        fileUrl: await this.persistPdf(pdfBuffer, letterNo, letter.employeeId),
        variables: built.variables,
        templateCode: built.templateCode,
        templateVersion: built.templateVersion,
      };
    }

    const letterEmployeeInclude = {
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          phone: true,
        },
      },
      acknowledgement: true,
    } as const;

    const txResult = await this.prisma.$transaction(async (tx) => {
      const current = await tx.letter.findUnique({
        where: { id: letterId },
        include: letterEmployeeInclude,
      });
      if (!current) {
        throw new NotFoundException(`Letter with id ${letterId} not found`);
      }
      if (current.status === LetterStatus.REVERSED) {
        throw new BadRequestException('Cannot send a reversed letter');
      }
      if (current.status === LetterStatus.SENT) {
        return { alreadySent: true as const, letter: current };
      }
      if (
        current.letterType === LetterType.APPOINTMENT &&
        current.status !== LetterStatus.APPROVED
      ) {
        throw new BadRequestException(APPOINTMENT_SEND_REQUIRES_APPROVAL_MESSAGE);
      }

      if (current.letterType === LetterType.SUSPENSION) {
        return this.issueApprovedSuspensionInTx(tx, {
          letter: current,
          actingUserId,
          letterNo,
          letterLabel,
          requiresAck,
          replyDeadline,
          letterEmployeeInclude,
        });
      }

      const appointmentPatch =
        current.letterType === LetterType.APPOINTMENT && appointmentSend
          ? {
              fileUrl: appointmentSend.fileUrl,
              variables: appointmentSend.variables as Prisma.InputJsonValue,
              templateCode: appointmentSend.templateCode,
              templateVersion: appointmentSend.templateVersion,
            }
          : {};

      if (current.letterType === LetterType.APPOINTMENT) {
        const claimed = await tx.letter.updateMany({
          where: { id: letterId, status: LetterStatus.APPROVED },
          data: {
            status: LetterStatus.SENT,
            requiresAcknowledgement: requiresAck,
            replyDeadline: replyDeadline ?? undefined,
            ...appointmentPatch,
          },
        });
        if (claimed.count !== 1) {
          const raced = await tx.letter.findUnique({
            where: { id: letterId },
            include: letterEmployeeInclude,
          });
          if (raced?.status === LetterStatus.SENT) {
            return { alreadySent: true as const, letter: raced };
          }
          throw new BadRequestException(
            APPOINTMENT_SEND_REQUIRES_APPROVAL_MESSAGE,
          );
        }
        const record = await tx.letter.findUnique({
          where: { id: letterId },
          include: letterEmployeeInclude,
        });
        if (!record) {
          throw new NotFoundException(`Letter with id ${letterId} not found`);
        }
        await applyDisciplineDeductionOnLetterSend(tx, {
          employeeId: current.employeeId,
          letterType: current.letterType,
          variables: current.variables,
          content: current.content,
        });
        await tx.notification.create({
          data: {
            employeeId: letter.employeeId,
            type: 'LETTER_ISSUED',
            message: `A ${letterLabel} letter (${letterNo}) has been issued to you.`,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: actingUserId,
            action: 'LETTER_SENT',
            entity: 'Letter',
            entityId: letterId,
            changes: { letterNo, letterType: letter.letterType },
          },
        });
        await this.notifyInquiryResolvedOnFinalLetterSend(tx, current);
        return { alreadySent: false as const, letter: record };
      }

      const record = await tx.letter.update({
        where: { id: letterId },
        data: {
          status: LetterStatus.SENT,
          requiresAcknowledgement: requiresAck,
          replyDeadline: replyDeadline ?? undefined,
          ...appointmentPatch,
        },
        include: letterEmployeeInclude,
      });

      await applyDisciplineDeductionOnLetterSend(tx, {
        employeeId: current.employeeId,
        letterType: current.letterType,
        variables: current.variables,
        content: current.content,
      });

      await tx.notification.create({
        data: {
          employeeId: letter.employeeId,
          type: 'LETTER_ISSUED',
          message: `A ${letterLabel} letter (${letterNo}) has been issued to you.`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'LETTER_SENT',
          entity: 'Letter',
          entityId: letterId,
          changes: { letterNo, letterType: letter.letterType },
        },
      });

      await this.notifyInquiryResolvedOnFinalLetterSend(tx, current);

      return { alreadySent: false as const, letter: record };
    });

    if (txResult.alreadySent) {
      return {
        letter: txResult.letter,
        alreadySent: true,
        message: 'Letter already sent to portal',
      };
    }

    const updated = txResult.letter;

    // Best-effort WhatsApp after portal publish
    try {
      const { buffer, filename } = await this.getPdf(letterId);
      const phone = updated.employee?.phone ?? null;
      await this.whatsappService.deliverAfterLetterGenerated({
        letterId,
        employeeId: letter.employeeId,
        employeeName: updated.employee?.fullName ?? '',
        letterType: letter.letterType,
        phone,
        fileUrl: updated.fileUrl,
        pdfBuffer: buffer,
        filename,
      });
    } catch (err) {
      console.error(`WhatsApp deliver after send failed for ${letterId}:`, err);
    }

    return { letter: updated, alreadySent: false };
  }

  private async issueApprovedSuspensionInTx(
    tx: Prisma.TransactionClient,
    opts: {
      letter: {
        id: string;
        employeeId: string;
        letterType: LetterType;
        status: LetterStatus;
      };
      actingUserId: string;
      letterNo: string;
      letterLabel: string;
      requiresAck: boolean;
      replyDeadline: Date | null | undefined;
      letterEmployeeInclude: {
        employee: {
          select: {
            id: true;
            fullName: true;
            employeeCode: true;
            phone: true;
          };
        };
        acknowledgement: true;
      };
    },
  ) {
    const request = await tx.suspensionRequest.findUnique({
      where: { letterId: opts.letter.id },
      include: {
        disciplinaryAction: { include: { inquiry: true } },
      },
    });

    if (!request || request.status !== SuspensionRequestStatus.APPROVED) {
      throw new BadRequestException(
        'This suspension cannot be issued until the suspension request has been approved.',
      );
    }
    if (request.letterId !== opts.letter.id) {
      throw new BadRequestException(
        'Suspension request is not linked to this letter.',
      );
    }
    if (request.employeeId !== opts.letter.employeeId) {
      throw new BadRequestException(
        'Suspension request employee does not match this letter.',
      );
    }

    const action = request.disciplinaryAction;
    if (!action || action.type !== DisciplinaryType.SUSPENSION) {
      throw new BadRequestException(
        'Suspension request is not linked to a SUSPENSION disciplinary case.',
      );
    }
    if (action.employeeId !== opts.letter.employeeId) {
      throw new BadRequestException(
        'Disciplinary action employee does not match this letter.',
      );
    }
    if (
      action.status === DisciplinaryStatus.RESOLVED ||
      action.status === DisciplinaryStatus.DISMISSED
    ) {
      throw new BadRequestException(
        'Cannot issue a suspension for a resolved or dismissed disciplinary case.',
      );
    }
    if (!request.decidedById || !request.decidedAt) {
      throw new BadRequestException(
        'Suspension request is missing approval decision metadata.',
      );
    }
    if (
      !request.periodStart ||
      !request.periodEnd ||
      !request.inquiryOfficerUserId ||
      !request.inquiryDeadlineAt
    ) {
      throw new BadRequestException(
        'Suspension request is missing period or inquiry details.',
      );
    }

    const officer = await tx.user.findUnique({
      where: { id: request.inquiryOfficerUserId },
      select: { id: true },
    });
    if (!officer) {
      throw new BadRequestException('Inquiry officer was not found.');
    }

    const employee = await tx.employee.findUnique({
      where: { id: opts.letter.employeeId },
      select: { status: true, currentBranchId: true },
    });
    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${opts.letter.employeeId} not found`,
      );
    }
    if (TERMINAL_EMPLOYEE_STATUSES.includes(employee.status)) {
      throw new BadRequestException(
        `Cannot issue a suspension letter to a ${employee.status} employee.`,
      );
    }
    if (employee.status === EmployeeStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'An employee pending onboarding approval cannot be suspended.',
      );
    }

    const existingInquiry = action.inquiry;
    if (
      existingInquiry?.closedAt ||
      existingInquiry?.outcome ||
      existingInquiry?.finding ||
      existingInquiry?.finalAction
    ) {
      throw new BadRequestException(
        'Cannot issue this suspension because the linked inquiry is already closed.',
      );
    }

    const letterUpdate = await tx.letter.updateMany({
      where: { id: opts.letter.id, status: LetterStatus.DRAFT },
      data: {
        status: LetterStatus.SENT,
        requiresAcknowledgement: opts.requiresAck,
        replyDeadline: opts.replyDeadline ?? undefined,
      },
    });
    if (letterUpdate.count !== 1) {
      const raced = await tx.letter.findUnique({
        where: { id: opts.letter.id },
        include: opts.letterEmployeeInclude,
      });
      if (raced?.status === LetterStatus.SENT) {
        return { alreadySent: true as const, letter: raced };
      }
      throw new BadRequestException(
        'This suspension letter could not be issued because its status changed.',
      );
    }

    const issuedAt = new Date();
    const requestUpdate = await tx.suspensionRequest.updateMany({
      where: {
        id: request.id,
        status: SuspensionRequestStatus.APPROVED,
        letterId: opts.letter.id,
      },
      data: {
        status: SuspensionRequestStatus.ISSUED,
        issuedAt,
        suspendedFromBranchId: employee.currentBranchId,
      },
    });
    if (requestUpdate.count !== 1) {
      throw new BadRequestException(
        'This suspension request is no longer approved and cannot be issued.',
      );
    }

    if (employee.status !== EmployeeStatus.SUSPENDED) {
      await tx.employee.update({
        where: { id: opts.letter.employeeId },
        data: { status: EmployeeStatus.SUSPENDED },
      });
    }

    await tx.disciplinaryAction.update({
      where: { id: action.id },
      data: { status: DisciplinaryStatus.UNDER_INQUIRY },
    });

    if (existingInquiry) {
      await tx.inquiry.update({
        where: { id: existingInquiry.id },
        data: {
          inquiryOfficerUserId: request.inquiryOfficerUserId,
          deadlineAt: request.inquiryDeadlineAt,
        },
      });
    } else {
      const createdInquiry = await tx.inquiry.create({
        data: {
          disciplinaryActionId: action.id,
          inquiryOfficerUserId: request.inquiryOfficerUserId,
          deadlineAt: request.inquiryDeadlineAt,
        },
      });
      await tx.notification.create({
        data: {
          employeeId: opts.letter.employeeId,
          type: 'INQUIRY_STARTED',
          message: `An inquiry has been initiated regarding your disciplinary action. Deadline: ${this.formatDate(request.inquiryDeadlineAt)}`,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: opts.actingUserId,
          action: 'INQUIRY_STARTED',
          entity: 'Inquiry',
          entityId: createdInquiry.id,
          changes: { disciplinaryActionId: action.id },
        },
      });
    }

    const record = await tx.letter.findUnique({
      where: { id: opts.letter.id },
      include: opts.letterEmployeeInclude,
    });
    if (!record) {
      throw new NotFoundException(`Letter with id ${opts.letter.id} not found`);
    }

    await tx.notification.create({
      data: {
        employeeId: opts.letter.employeeId,
        type: 'LETTER_ISSUED',
        message: `A ${opts.letterLabel} letter (${opts.letterNo}) has been issued to you.`,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: opts.actingUserId,
        action: 'LETTER_SENT',
        entity: 'Letter',
        entityId: opts.letter.id,
        changes: {
          letterNo: opts.letterNo,
          letterType: opts.letter.letterType,
          suspensionRequestId: request.id,
          issued: true,
        },
      },
    });

    return { alreadySent: false as const, letter: record };
  }

  private async notifyInquiryResolvedOnFinalLetterSend(
    tx: Prisma.TransactionClient,
    letter: { employeeId: string; content?: unknown },
  ) {
    const stamps = letterContentStamps(letter.content);
    if (
      !stamps.inquiryId ||
      !stamps.inquiryLetterKind ||
      !isResolutionTriggerKind(stamps.inquiryLetterKind)
    ) {
      return;
    }
    const inquiry = await tx.inquiry.findUnique({
      where: { id: stamps.inquiryId },
      select: { id: true, finding: true, closedAt: true },
    });
    if (!inquiry?.closedAt || !inquiry.finding) {
      return;
    }
    await ensureInquiryResolvedNotification(tx, {
      employeeId: letter.employeeId,
      inquiryId: inquiry.id,
      finding: inquiry.finding,
    });
  }

  async reverseLetter(
    letterId: string,
    dto: ReverseLetterDto,
    actingUserId: string,
  ) {
    const letter = await this.findOne(letterId);

    if (letter.status === LetterStatus.DRAFT) {
      throw new BadRequestException(
        'Draft letters should be deleted, not reversed',
      );
    }
    if (letter.status === LetterStatus.REVERSED) {
      throw new ConflictException('Letter is already reversed');
    }

    const vars = (letter.variables ?? {}) as Record<string, unknown>;
    let fineUndone = false;
    let fineSkippedReason: string | null = null;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.letter.update({
        where: { id: letterId },
        data: {
          status: LetterStatus.REVERSED,
          requiresAcknowledgement: false,
          reversedAt: new Date(),
          reversedById: actingUserId,
          reversalReason: dto.reason.trim(),
          variables: {
            ...vars,
            reversed: true,
            reversedAt: new Date().toISOString(),
            reversalReason: dto.reason.trim(),
          } as Prisma.InputJsonValue,
        },
        include: {
          employee: { select: { fullName: true, employeeCode: true } },
          acknowledgement: true,
        },
      });

      // Unwind pending fine deduction linked by incident date / occurrence
      if (
        letter.letterType === LetterType.FINE ||
        letter.letterType === LetterType.EXPLANATION_FINE
      ) {
        const unwind = await this.tryUnwindFineDeduction(tx, letter);
        fineUndone = unwind.undone;
        fineSkippedReason = unwind.skippedReason;
      }

      // Soft-mark linked DisciplineEvent for the incident date when present
      const incidentDateRaw =
        (typeof vars.incidentDate === 'string' && vars.incidentDate) ||
        (typeof vars.suspensionStartDate === 'string' &&
          vars.suspensionStartDate) ||
        null;
      if (incidentDateRaw) {
        const day = new Date(`${incidentDateRaw.slice(0, 10)}T00:00:00.000Z`);
        if (!Number.isNaN(day.getTime())) {
          await tx.disciplineEvent.deleteMany({
            where: {
              employeeId: letter.employeeId,
              incidentDate: day,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'LETTER_REVERSED',
          entity: 'Letter',
          entityId: letterId,
          changes: {
            reason: dto.reason.trim(),
            fineUndone,
            fineSkippedReason,
          },
        },
      });

      return updated;
    });

    return {
      letter: result,
      fineUndone,
      fineSkippedReason,
      message: fineSkippedReason
        ? `Letter reversed; ${fineSkippedReason}`
        : fineUndone
          ? 'Letter reversed; pending fine undone'
          : 'Letter reversed',
    };
  }

  private async tryUnwindFineDeduction(
    tx: Prisma.TransactionClient,
    letter: {
      employeeId: string;
      letterType: LetterType;
      variables: unknown;
      generatedAt: Date;
    },
  ): Promise<{ undone: boolean; skippedReason: string | null }> {
    const vars = (letter.variables ?? {}) as Record<string, unknown>;
    const incidentDate =
      typeof vars.incidentDate === 'string'
        ? vars.incidentDate.slice(0, 10)
        : null;

    const deductions = await tx.payrollDeduction.findMany({
      where: {
        payrollEntry: {
          stipendRecord: { employeeId: letter.employeeId },
        },
        reason: {
          in: [DeductionType.DISCIPLINARY_FINE, DeductionType.LATE_ARRIVAL],
        },
        ...(incidentDate
          ? { description: { contains: incidentDate } }
          : {}),
      },
      include: {
        payrollEntry: {
          select: {
            id: true,
            status: true,
            totalDeductions: true,
            netStipend: true,
          },
        },
      },
      take: 10,
    });

    if (deductions.length === 0) {
      return { undone: false, skippedReason: null };
    }

    const pending = deductions.find(
      (d) => d.payrollEntry.status === PayrollStatus.PENDING,
    );
    if (!pending) {
      return {
        undone: false,
        skippedReason: 'fine not undone (payroll finalized)',
      };
    }

    const amount = Number(pending.amount);
    await tx.payrollDeduction.delete({ where: { id: pending.id } });
    await tx.payrollEntry.update({
      where: { id: pending.payrollEntry.id },
      data: {
        totalDeductions: {
          decrement: amount,
        },
        netStipend: {
          increment: amount,
        },
      },
    });

    return { undone: true, skippedReason: null };
  }

  async findAll(
    query: LetterQueryDto,
    actingUser?: { id: string; role: UserRole; portalOnly?: boolean },
  ) {
    const where: Prisma.LetterWhereInput = {};

    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }

    if (query.letterType) {
      where.letterType = query.letterType;
    }

    if (query.statusIn?.length) {
      where.status = { in: query.statusIn };
    } else if (query.status) {
      where.status = query.status;
    } else if (actingUser?.portalOnly) {
      where.status = LetterStatus.SENT;
    }

    if (query.startDate && query.endDate) {
      where.generatedAt = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    }

    if (actingUser?.id && !actingUser.portalOnly) {
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
        suspensionRequest: SUSPENSION_REQUEST_ON_LETTER,
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
      status: LetterStatus.SENT,
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

  async findOne(
    letterId: string,
    actor?: {
      id: string;
      role: UserRole;
      roles?: UserRole[];
      employeeId?: string | null;
      portalOnly?: boolean;
    },
  ) {
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
        suspensionRequest: SUSPENSION_REQUEST_ON_LETTER,
      },
    });

    if (!letter) {
      throw new NotFoundException(`Letter with id ${letterId} not found`);
    }

    this.assertPortalLetterAccess(letter, letterId, actor);

    return letter;
  }

  async getPdf(
    letterId: string,
    actor?: {
      id: string;
      role: UserRole;
      roles?: UserRole[];
      employeeId?: string | null;
      portalOnly?: boolean;
    },
  ) {
    const letter = await this.findOne(letterId, actor);

    // Always rebuild from the stored letter number so download / WhatsApp
    // attachments cannot serve a PDF that was generated without letterNo.
    const repaired = await this.regeneratePdfForLetter(letter);
    if (repaired) {
      return repaired;
    }

    if (letter.fileUrl) {
      try {
        return await this.loadExistingPdf(letter);
      } catch {
        // Fall through to the same not-found message as a missing file.
      }
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
    status?: LetterStatus;
    templateCode?: string | null;
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
        const code = String(letter.templateCode ?? SELECTION_TEMPLATE_CODE);
        const template = await this.prisma.letterTemplate.findFirst({
          where: { code, active: true },
        });
        if (!template || !storedVars) return null;
        const bodyHtml =
          storedVars.appointmentLanguage === 'EN' && template.bodyHtmlEn
            ? template.bodyHtmlEn
            : template.bodyHtml;
        htmlContent = renderHandlebarsTemplate(bodyHtml, {
          ...storedVars,
          letterNo: String(letterNo),
          chairmanAdminName: APPOINTMENT_CHAIRMAN_ADMIN_NAME,
        } as SelectionLetterVariables);
        if (letter.status !== LetterStatus.SENT) {
          htmlContent = applyAppointmentDraftWatermark(htmlContent);
        } else {
          htmlContent = stripAppointmentDraftWatermark(htmlContent);
        }
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
        merged.letterNo = String(letterNo);
        merged.letterRef = buildLetterRef(
          letter.letterType,
          String(letterNo),
          template.letterCode,
        );
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

    if (letter.status !== LetterStatus.DRAFT) {
      throw new BadRequestException(
        'Only draft letters can be deleted. Ask IT to reverse a sent letter.',
      );
    }

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

  private isEmployeePortalActor(actor?: {
    role: UserRole;
    roles?: UserRole[];
    portalOnly?: boolean;
  }): boolean {
    if (!actor) return false;
    if (actor.portalOnly) return true;
    const roles = actor.roles?.length ? actor.roles : [actor.role];
    return roles.length === 1 && roles[0] === UserRole.EMPLOYEE;
  }

  private assertPortalLetterAccess(
    letter: { employeeId: string; status: LetterStatus },
    letterId: string,
    actor?: {
      id: string;
      role: UserRole;
      roles?: UserRole[];
      employeeId?: string | null;
      portalOnly?: boolean;
    },
  ) {
    if (!this.isEmployeePortalActor(actor)) {
      return;
    }
    if (!actor?.employeeId || letter.employeeId !== actor.employeeId) {
      throw new NotFoundException(`Letter with id ${letterId} not found`);
    }
    if (letter.status !== LetterStatus.SENT) {
      throw new ForbiddenException(
        'Draft and reversed letters are not available in the employee portal',
      );
    }
  }

  private formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
