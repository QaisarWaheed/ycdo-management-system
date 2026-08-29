import {
  AppointmentLetterLanguage,
} from '@prisma/client';
import { AppointmentMappingsService } from './appointment-mappings.service';
import { APPOINTMENT_CHAIRMAN_ADMIN_NAME } from './appointment-signatory';
import { APPOINTMENT_DRAFT_WATERMARK_TEXT } from './appointment-watermark';

describe('AppointmentMappingsService', () => {
  function build() {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      letterTemplate: {
        findMany: jest.fn().mockResolvedValue([
          { code: 'APPT_MEDICAL_CLINICAL_EN', name: 'Clinical', active: true },
        ]),
        findFirst: jest.fn().mockResolvedValue({
          code: 'APPT_MEDICAL_CLINICAL_EN',
          active: true,
          bodyHtml: '<p>{{serviceArea}} {{chairmanAdminName}} {{{departmentSpecificSops}}}</p>',
        }),
      },
      department: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'dept-1',
          name: 'OPD',
          isDeleted: false,
        }),
        findUnique: jest.fn().mockResolvedValue({ id: 'dept-1', name: 'OPD' }),
      },
      designation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'des-1',
          title: 'MEDICAL OFFICER',
          isDeleted: false,
        }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'des-1', title: 'MEDICAL OFFICER', isActive: true },
          { id: 'des-bad', title: 'ADMIN+LAB', isActive: true },
          { id: 'des-lhv', title: 'LHV', isActive: true },
        ]),
      },
      employee: {
        findMany: jest.fn().mockResolvedValue([
          {
            currentDepartmentId: 'dept-1',
            currentDesignation: 'MEDICAL OFFICER',
            currentDepartment: { id: 'dept-1', name: 'OPD', isDeleted: false },
          },
          {
            currentDepartmentId: 'dept-1',
            currentDesignation: 'MEDICAL OFFICER',
            currentDepartment: { id: 'dept-1', name: 'OPD', isDeleted: false },
          },
          {
            currentDepartmentId: 'dept-1',
            currentDesignation: 'LHV',
            currentDepartment: { id: 'dept-1', name: 'OPD', isDeleted: false },
          },
          {
            currentDepartmentId: 'dept-1',
            currentDesignation: 'UNKNOWN TITLE',
            currentDepartment: { id: 'dept-1', name: 'OPD', isDeleted: false },
          },
          {
            currentDepartmentId: 'dept-admin',
            currentDesignation: 'ADMIN+LAB',
            currentDepartment: {
              id: 'dept-admin',
              name: 'ADMINISTRATION',
              isDeleted: false,
            },
          },
        ]),
      },
      appointmentTemplateMapping: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'map-1',
            departmentId: 'dept-1',
            designationId: 'des-1',
            active: true,
            templateCode: 'APPT_MEDICAL_CLINICAL_EN',
            language: AppointmentLetterLanguage.EN,
          },
          {
            id: 'map-inactive',
            departmentId: 'dept-1',
            designationId: 'des-lhv',
            active: false,
            templateCode: 'APPT_CLINICAL_SUPPORT_UR',
            language: AppointmentLetterLanguage.UR,
          },
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation(async ({ data }) => {
          created.push(data);
          return { id: 'map-new', ...data };
        }),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'map-1',
          ...data,
        })),
        delete: jest.fn().mockResolvedValue({}),
      },
    };

    const service = new AppointmentMappingsService(prisma as never);
    return { service, prisma, created };
  }

  it('creates an exact mapping and rejects fixture / SELECTION_LETTER', async () => {
    const { service, prisma } = build();
    await service.create({
      departmentId: 'dept-1',
      designationId: 'des-1',
      language: AppointmentLetterLanguage.EN,
      templateCode: 'APPT_MEDICAL_CLINICAL_EN',
    });
    expect(prisma.appointmentTemplateMapping.create).toHaveBeenCalled();

    await expect(
      service.create({
        departmentId: 'dept-1',
        designationId: 'des-1',
        language: AppointmentLetterLanguage.EN,
        templateCode: 'SELECTION_LETTER',
      }),
    ).rejects.toThrow(/APPT_/);

    await expect(
      service.create({
        departmentId: 'dept-1',
        designationId: 'des-1',
        language: AppointmentLetterLanguage.EN,
        templateCode: 'APPOINTMENT_FIXTURE_EN',
      }),
    ).rejects.toThrow(/Fixture/);
  });

  it('requires designation unless department fallback is explicit', async () => {
    const { service } = build();
    await expect(
      service.create({
        departmentId: 'dept-1',
        language: AppointmentLetterLanguage.EN,
        templateCode: 'APPT_MEDICAL_CLINICAL_EN',
      }),
    ).rejects.toThrow(/Designation is required/);
  });

  it('surfaces a friendly error for duplicate active exact mappings', async () => {
    const { service, prisma } = build();
    prisma.appointmentTemplateMapping.create.mockRejectedValue({ code: 'P2002' });
    await expect(
      service.create({
        departmentId: 'dept-1',
        designationId: 'des-1',
        language: AppointmentLetterLanguage.EN,
        templateCode: 'APPT_MEDICAL_CLINICAL_EN',
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('deactivates an active mapping instead of deleting it', async () => {
    const { service, prisma } = build();
    prisma.appointmentTemplateMapping.findUnique.mockResolvedValue({
      id: 'map-1',
      active: true,
      departmentId: 'dept-1',
      designationId: 'des-1',
    });
    await service.remove('map-1');
    expect(prisma.appointmentTemplateMapping.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ active: false }),
      }),
    );
    expect(prisma.appointmentTemplateMapping.delete).not.toHaveBeenCalled();
  });

  it('aggregates coverage statuses including ADMIN+LAB invalid and employeeCount', async () => {
    const { service } = build();
    const result = await service.coverage();
    expect(result.summary.mapped).toBe(1);
    expect(result.summary.missingCatalog).toBe(1);
    expect(result.summary.inactiveMapping).toBe(1);
    const mapped = result.rows.find((r) => r.status === 'MAPPED');
    expect(mapped?.employeeCount).toBe(2);
    expect(mapped?.templateCode).toBe('APPT_MEDICAL_CLINICAL_EN');
    const invalid = result.rows.find((r) => r.status === 'INVALID_ROLE');
    expect(invalid?.designation).toBe('ADMIN+LAB');
    const missingCat = result.rows.find(
      (r) => r.status === 'MISSING_DESIGNATION_CATALOG',
    );
    expect(missingCat?.designation).toBe('UNKNOWN TITLE');
  });

  it('previews EN/UR samples with watermark and no Letter row', async () => {
    const { service, prisma } = build();
    const en = await service.previewSample({
      templateCode: 'APPT_MEDICAL_CLINICAL_EN',
      departmentName: 'OPD',
    });
    expect(en.previewHtml).toContain(APPOINTMENT_DRAFT_WATERMARK_TEXT);
    expect(en.variables.chairmanAdminName).toBe(APPOINTMENT_CHAIRMAN_ADMIN_NAME);
    expect(en.previewHtml).toContain('Medical Services');
    expect(prisma.appointmentTemplateMapping.create).not.toHaveBeenCalled();

    prisma.letterTemplate.findFirst.mockResolvedValue({
      code: 'APPT_VTI_UR',
      active: true,
      bodyHtml: '<p>{{serviceArea}} {{chairmanAdminName}}</p>',
    });
    const ur = await service.previewSample({
      templateCode: 'APPT_VTI_UR',
      departmentName: 'VTI',
    });
    expect(ur.language).toBe(AppointmentLetterLanguage.UR);
    expect(ur.previewHtml).toContain(APPOINTMENT_DRAFT_WATERMARK_TEXT);
    expect(ur.variables.serviceArea).toBe('Vocational Training Services');
  });

  it('rejects mapping ADMIN+LAB', async () => {
    const { service, prisma } = build();
    prisma.designation.findFirst.mockResolvedValue({
      id: 'des-bad',
      title: 'ADMIN+LAB',
    });
    prisma.department.findUnique.mockResolvedValue({
      id: 'dept-admin',
      name: 'ADMINISTRATION',
    });
    await expect(
      service.create({
        departmentId: 'dept-admin',
        designationId: 'des-bad',
        language: AppointmentLetterLanguage.EN,
        templateCode: 'APPT_ADMIN_FINANCE_EN',
      }),
    ).rejects.toThrow(/invalid assignment/);
  });
});
