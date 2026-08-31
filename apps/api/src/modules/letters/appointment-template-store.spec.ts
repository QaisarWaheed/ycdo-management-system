import { loadOrCreateAppointmentLetterTemplate } from './appointment-template-store';

describe('loadOrCreateAppointmentLetterTemplate', () => {
  it('returns an existing active row without creating', async () => {
    const existing = {
      code: 'APPT_LAB_SUPPORT_EN',
      bodyHtml: '<p>EN</p>',
      bodyHtmlEn: null,
      requiredVars: ['stipendAmount'],
      version: 1,
    };
    const db = {
      letterTemplate: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
      },
    };

    const row = await loadOrCreateAppointmentLetterTemplate(
      db as never,
      'APPT_LAB_SUPPORT_EN',
    );
    expect(row.code).toBe('APPT_LAB_SUPPORT_EN');
    expect(db.letterTemplate.create).not.toHaveBeenCalled();
  });

  it('creates APPT_LAB_SUPPORT_EN from disk when the row is missing', async () => {
    const created = {
      code: 'APPT_LAB_SUPPORT_EN',
      bodyHtml: '<p>created</p>',
      bodyHtmlEn: null,
      requiredVars: ['stipendAmount'],
      version: 1,
    };
    const db = {
      letterTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
    };

    const row = await loadOrCreateAppointmentLetterTemplate(
      db as never,
      'APPT_LAB_SUPPORT_EN',
    );
    expect(row).toEqual(created);
    expect(db.letterTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'APPT_LAB_SUPPORT_EN',
          active: true,
        }),
      }),
    );
  });
});
