import { AppointmentLetterLanguage } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import {
  APPOINTMENT_MAPPING_MISSING_MESSAGE,
  resolveAppointmentTemplateMapping,
} from './appointment-template-mapping';

describe('resolveAppointmentTemplateMapping', () => {
  function db(opts: {
    designationId?: string | null;
    mappings: Array<{
      id: string;
      departmentId: string | null;
      designationId: string | null;
      language: AppointmentLetterLanguage;
      templateCode: string;
    }>;
  }) {
    return {
      designation: {
        findFirst: jest.fn().mockResolvedValue(
          opts.designationId ? { id: opts.designationId } : null,
        ),
      },
      appointmentTemplateMapping: {
        findFirst: jest.fn().mockImplementation(
          async ({
            where,
          }: {
            where: {
              departmentId: string | null;
              designationId: string | null;
            };
          }) =>
            opts.mappings.find(
              (row) =>
                row.departmentId === (where.departmentId ?? null) &&
                row.designationId === (where.designationId ?? null),
            ) ?? null,
        ),
      },
    };
  }

  it('resolves exact Department + Designation and language', async () => {
    const result = await resolveAppointmentTemplateMapping(
      db({
        designationId: 'des-1',
        mappings: [
          {
            id: 'map-1',
            departmentId: 'dept-a',
            designationId: 'des-1',
            language: AppointmentLetterLanguage.UR,
            templateCode: 'APPOINTMENT_FIXTURE_UR',
          },
        ],
      }),
      { departmentId: 'dept-a', designationTitle: 'Nurse' },
    );
    expect(result.match).toBe('EXACT');
    expect(result.language).toBe(AppointmentLetterLanguage.UR);
    expect(result.templateCode).toBe('APPOINTMENT_FIXTURE_UR');
  });

  it('uses department fallback then global, and fails closed', async () => {
    const dept = await resolveAppointmentTemplateMapping(
      db({
        designationId: 'des-1',
        mappings: [
          {
            id: 'map-d',
            departmentId: 'dept-a',
            designationId: null,
            language: AppointmentLetterLanguage.EN,
            templateCode: 'APPOINTMENT_FIXTURE_EN',
          },
        ],
      }),
      { departmentId: 'dept-a', designationTitle: 'Nurse' },
    );
    expect(dept.match).toBe('DEPARTMENT');

    const global = await resolveAppointmentTemplateMapping(
      db({
        designationId: 'des-1',
        mappings: [
          {
            id: 'map-g',
            departmentId: null,
            designationId: null,
            language: AppointmentLetterLanguage.EN,
            templateCode: 'APPOINTMENT_FIXTURE_EN',
          },
        ],
      }),
      { departmentId: 'dept-b', designationTitle: 'Nurse' },
    );
    expect(global.match).toBe('GLOBAL');

    await expect(
      resolveAppointmentTemplateMapping(
        db({ designationId: 'des-1', mappings: [] }),
        { departmentId: 'dept-a', designationTitle: 'Nurse' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      resolveAppointmentTemplateMapping(
        db({ designationId: 'des-1', mappings: [] }),
        { departmentId: 'dept-a', designationTitle: 'Nurse' },
      ),
    ).rejects.toThrow(APPOINTMENT_MAPPING_MISSING_MESSAGE);
  });
});
