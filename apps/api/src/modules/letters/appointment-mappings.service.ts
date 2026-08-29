import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentLetterLanguage,
  EmployeeStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  APPOINTMENT_TEMPLATE_CODES,
  appointmentFamilyMeta,
  isAppointmentTemplateCode,
  isInvalidAppointmentAssignment,
  resolveAppointmentServiceArea,
} from './appointment-families';
import {
  CreateAppointmentMappingDto,
  UpdateAppointmentMappingDto,
} from './appointment-mappings.dto';
import { APPOINTMENT_CHAIRMAN_ADMIN_NAME } from './appointment-signatory';
import { appointmentSopHtml } from './appointment-sop';
import { applyAppointmentDraftWatermark } from './appointment-watermark';
import { appendComputerGeneratedNotice } from './letter-templates.helper';
import {
  buildOrgVariables,
  renderHandlebarsTemplate,
} from './selection-letter.helper';
import { URDU_LETTER_STYLES } from './urdu-letter-styles';

export const APPOINTMENT_MAPPING_ROLES = [
  'SUPER_ADMIN',
  'HR_MANAGER',
  'HR_ADMIN_MANAGER',
  'ADMIN_MANAGER',
] as const;

const REJECTED_TEMPLATE_CODES = new Set([
  'SELECTION_LETTER',
  'APPOINTMENT_FIXTURE_EN',
  'APPOINTMENT_FIXTURE_UR',
]);

const EXCLUDED_EMPLOYEE_STATUSES: EmployeeStatus[] = [
  EmployeeStatus.TERMINATED,
  EmployeeStatus.RESIGNED,
  EmployeeStatus.DISMISSED,
];

export type AppointmentCoverageStatus =
  | 'MAPPED'
  | 'MISSING_MAPPING'
  | 'MISSING_DESIGNATION_CATALOG'
  | 'INVALID_ROLE'
  | 'INACTIVE_MAPPING';

@Injectable()
export class AppointmentMappingsService {
  constructor(private prisma: PrismaService) {}

  async listTemplates() {
    const rows = await this.prisma.letterTemplate.findMany({
      where: {
        active: true,
        code: { in: [...APPOINTMENT_TEMPLATE_CODES] },
      },
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({
      ...row,
      familyName: appointmentFamilyMeta(row.code)?.name ?? row.name,
      language: appointmentFamilyMeta(row.code)?.language ?? null,
    }));
  }

  async listMappings() {
    return this.prisma.appointmentTemplateMapping.findMany({
      include: {
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, title: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  async create(dto: CreateAppointmentMappingDto) {
    const designationId = dto.applyToUnmappedDesignations
      ? null
      : dto.designationId?.trim() || null;
    if (!dto.applyToUnmappedDesignations && !designationId) {
      throw new BadRequestException(
        'Designation is required for an exact mapping. Tick “Applies to all unmapped designations in this department” only for a department fallback.',
      );
    }
    await this.assertDepartment(dto.departmentId);
    if (designationId) {
      await this.assertDesignationNotInvalid(dto.departmentId, designationId);
    }
    const templateCode = await this.assertAppointmentTemplate(dto.templateCode);
    this.assertLanguageMatchesTemplate(dto.language, templateCode);

    try {
      return await this.prisma.appointmentTemplateMapping.create({
        data: {
          departmentId: dto.departmentId,
          designationId,
          language: dto.language,
          templateCode,
          active: dto.active ?? true,
        },
        include: {
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, title: true } },
        },
      });
    } catch (err) {
      this.rethrowMappingConflict(err);
    }
  }

  async update(id: string, dto: UpdateAppointmentMappingDto) {
    const current = await this.prisma.appointmentTemplateMapping.findUnique({
      where: { id },
    });
    if (!current) {
      throw new NotFoundException('Appointment mapping not found');
    }
    if (dto.departmentId !== undefined && !dto.departmentId) {
      throw new BadRequestException('Global Appointment mappings are not allowed.');
    }

    const applyAll =
      dto.applyToUnmappedDesignations ?? current.designationId == null;
    const departmentId = dto.departmentId ?? current.departmentId;
    if (!departmentId) {
      throw new BadRequestException('Department is required for Appointment mappings.');
    }
    const designationId = applyAll
      ? null
      : dto.designationId === undefined
        ? current.designationId
        : dto.designationId;
    if (!applyAll && !designationId) {
      throw new BadRequestException(
        'Designation is required for an exact mapping.',
      );
    }

    await this.assertDepartment(departmentId);
    if (designationId) {
      await this.assertDesignationNotInvalid(departmentId, designationId);
    }
    const templateCode = dto.templateCode
      ? await this.assertAppointmentTemplate(dto.templateCode)
      : current.templateCode;
    const language = dto.language ?? current.language;
    this.assertLanguageMatchesTemplate(language, templateCode);

    try {
      return await this.prisma.appointmentTemplateMapping.update({
        where: { id },
        data: {
          departmentId,
          designationId,
          language,
          templateCode,
          active: dto.active ?? current.active,
        },
        include: {
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, title: true } },
        },
      });
    } catch (err) {
      this.rethrowMappingConflict(err);
    }
  }

  async setActive(id: string, active: boolean) {
    const current = await this.prisma.appointmentTemplateMapping.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('Appointment mapping not found');
    if (!current.departmentId) {
      throw new BadRequestException('Global Appointment mappings cannot be activated.');
    }
    try {
      return await this.prisma.appointmentTemplateMapping.update({
        where: { id },
        data: { active },
        include: {
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, title: true } },
        },
      });
    } catch (err) {
      this.rethrowMappingConflict(err);
    }
  }

  async remove(id: string) {
    const current = await this.prisma.appointmentTemplateMapping.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('Appointment mapping not found');
    if (current.active) {
      return this.setActive(id, false);
    }
    await this.prisma.appointmentTemplateMapping.delete({ where: { id } });
    return { id, deleted: true };
  }

  async coverage() {
    const employees = await this.prisma.employee.findMany({
      where: { status: { notIn: EXCLUDED_EMPLOYEE_STATUSES } },
      select: {
        currentDepartmentId: true,
        currentDesignation: true,
        currentDepartment: { select: { id: true, name: true, isDeleted: true } },
      },
    });

    const designations = await this.prisma.designation.findMany({
      where: { isDeleted: false },
      select: { id: true, title: true, isActive: true },
    });
    const designationByTitle = new Map(
      designations.map((row) => [row.title.trim().toUpperCase(), row]),
    );

    const mappings = await this.prisma.appointmentTemplateMapping.findMany({
      include: {
        designation: { select: { title: true } },
      },
    });

    type Agg = {
      departmentId: string | null;
      department: string;
      designation: string;
      employeeCount: number;
    };
    const groups = new Map<string, Agg>();
    for (const emp of employees) {
      const department = emp.currentDepartment?.name ?? '—';
      const designation = (emp.currentDesignation ?? '').trim() || '—';
      const key = `${emp.currentDepartmentId ?? ''}::${designation.toUpperCase()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.employeeCount += 1;
      } else {
        groups.set(key, {
          departmentId: emp.currentDepartmentId,
          department,
          designation,
          employeeCount: 1,
        });
      }
    }

    const rows = [...groups.values()].map((group) => {
      const catalog = designationByTitle.get(group.designation.toUpperCase());
      const invalid = isInvalidAppointmentAssignment(
        group.department,
        group.designation,
      );
      const exact = mappings.filter(
        (row) =>
          row.departmentId === group.departmentId &&
          row.designationId &&
          catalog &&
          row.designationId === catalog.id,
      );
      const exactActive = exact.find((row) => row.active);
      const exactInactive = exact.find((row) => !row.active);
      const deptFallback = mappings.find(
        (row) =>
          row.active &&
          row.departmentId === group.departmentId &&
          row.designationId == null,
      );

      let status: AppointmentCoverageStatus;
      let templateCode: string | null = null;
      let language: AppointmentLetterLanguage | null = null;
      if (invalid) {
        status = 'INVALID_ROLE';
      } else if (!catalog) {
        status = 'MISSING_DESIGNATION_CATALOG';
      } else if (exactActive) {
        status = 'MAPPED';
        templateCode = exactActive.templateCode;
        language = exactActive.language;
      } else if (exactInactive) {
        status = 'INACTIVE_MAPPING';
        templateCode = exactInactive.templateCode;
        language = exactInactive.language;
      } else if (deptFallback) {
        status = 'MAPPED';
        templateCode = deptFallback.templateCode;
        language = deptFallback.language;
      } else {
        status = 'MISSING_MAPPING';
      }

      return {
        department: group.department,
        departmentId: group.departmentId,
        designation: group.designation,
        designationId: catalog?.id ?? null,
        employeeCount: group.employeeCount,
        designationCatalogExists: Boolean(catalog),
        mappingExists: Boolean(exactActive || deptFallback),
        templateCode,
        language,
        status,
      };
    });

    rows.sort(
      (a, b) =>
        a.department.localeCompare(b.department) ||
        a.designation.localeCompare(b.designation),
    );

    const summary = {
      total: rows.length,
      mapped: rows.filter((r) => r.status === 'MAPPED').length,
      missingMapping: rows.filter((r) => r.status === 'MISSING_MAPPING').length,
      missingCatalog: rows.filter(
        (r) => r.status === 'MISSING_DESIGNATION_CATALOG',
      ).length,
      invalidRole: rows.filter((r) => r.status === 'INVALID_ROLE').length,
      inactiveMapping: rows.filter((r) => r.status === 'INACTIVE_MAPPING').length,
    };

    return { summary, rows };
  }

  async previewSample(input: {
    mappingId?: string;
    templateCode?: string;
    departmentName?: string;
  }) {
    let templateCode = input.templateCode?.trim() || '';
    let departmentName = input.departmentName?.trim() || 'Sample Department';
    let language: AppointmentLetterLanguage = AppointmentLetterLanguage.EN;
    let designation = 'SAMPLE DESIGNATION';

    if (input.mappingId) {
      const mapping = await this.prisma.appointmentTemplateMapping.findUnique({
        where: { id: input.mappingId },
        include: {
          department: { select: { name: true } },
          designation: { select: { title: true } },
        },
      });
      if (!mapping) throw new NotFoundException('Appointment mapping not found');
      templateCode = mapping.templateCode;
      language = mapping.language;
      departmentName = mapping.department?.name ?? departmentName;
      designation = mapping.designation?.title ?? 'UNMAPPED DESIGNATIONS';
    }

    if (!isAppointmentTemplateCode(templateCode) || REJECTED_TEMPLATE_CODES.has(templateCode)) {
      throw new BadRequestException(
        'Preview is only available for active Appointment family templates (APPT_*).',
      );
    }
    const meta = appointmentFamilyMeta(templateCode);
    if (meta) language = meta.language;

    const template = await this.prisma.letterTemplate.findFirst({
      where: { code: templateCode, active: true },
    });
    if (!template) {
      throw new NotFoundException(`Appointment template ${templateCode} is not seeded.`);
    }

    const variables = {
      ...buildOrgVariables(),
      letterNo: 'PREVIEW/YCDO/0000',
      issueDate: '01/01/2026',
      salutation: 'Mr.',
      employeeName: 'Sample Volunteer',
      cnic: '35202-0000000-0',
      phone: '03000000000',
      designation,
      department: departmentName,
      branchName: 'Sample Branch',
      stipendAmount: '10000',
      hoursPerDay: '8',
      dutyTotalHours: '8',
      shiftName: 'General',
      scheduleFrom: '09:00 AM',
      scheduleTo: '05:00 PM',
      monthlyAllowedLeaves: '2',
      shortLeaveHours: '4',
      serviceArea: resolveAppointmentServiceArea(templateCode, departmentName),
      departmentSpecificSops: appointmentSopHtml(templateCode, language),
      chairmanAdminName: APPOINTMENT_CHAIRMAN_ADMIN_NAME,
      letterStyles:
        language === AppointmentLetterLanguage.UR ? URDU_LETTER_STYLES : '',
      digitalAcceptance: false,
    };

    const htmlContent = applyAppointmentDraftWatermark(
      appendComputerGeneratedNotice(
        renderHandlebarsTemplate(template.bodyHtml, variables),
      ),
    );

    return {
      previewHtml: htmlContent,
      variables,
      templateCode,
      language,
    };
  }

  private async assertDepartment(departmentId: string) {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, isDeleted: false },
    });
    if (!department) {
      throw new BadRequestException('Department was not found or is inactive.');
    }
    return department;
  }

  private async assertDesignationNotInvalid(
    departmentId: string,
    designationId: string,
  ) {
    const [department, designation] = await Promise.all([
      this.prisma.department.findUnique({ where: { id: departmentId } }),
      this.prisma.designation.findFirst({
        where: { id: designationId, isDeleted: false },
      }),
    ]);
    if (!designation) {
      throw new BadRequestException('Designation was not found or is inactive.');
    }
    if (isInvalidAppointmentAssignment(department?.name, designation.title)) {
      throw new BadRequestException(
        'ADMIN+LAB / ADMINISTRATION is an invalid assignment and cannot be mapped.',
      );
    }
    return designation;
  }

  private async assertAppointmentTemplate(code: string) {
    if (REJECTED_TEMPLATE_CODES.has(code) || !isAppointmentTemplateCode(code)) {
      throw new BadRequestException(
        'Only active Appointment family templates (APPT_*) can be mapped. Fixture and SELECTION_LETTER templates are not allowed.',
      );
    }
    const template = await this.prisma.letterTemplate.findFirst({
      where: { code, active: true },
    });
    if (!template) {
      throw new BadRequestException(
        `Template ${code} is missing or inactive.`,
      );
    }
    return code;
  }

  private assertLanguageMatchesTemplate(
    language: AppointmentLetterLanguage,
    templateCode: string,
  ) {
    const meta = appointmentFamilyMeta(templateCode);
    if (meta && meta.language !== language) {
      throw new BadRequestException(
        `Language ${language} does not match template family ${templateCode} (${meta.language}).`,
      );
    }
  }

  private rethrowMappingConflict(err: unknown): never {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : '';
    if (code === 'P2002') {
      throw new ConflictException(
        'An active Appointment mapping already exists for this Department and Designation.',
      );
    }
    throw err;
  }
}
