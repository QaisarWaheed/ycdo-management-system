import { LetterStatus, LetterType, UserRole } from '@prisma/client';

jest.mock('./pdf.helper', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

jest.mock('../../config/cloudinary.config', () => ({
  isCloudinaryEnabled: () => false,
  uploadPdfToCloudinary: jest.fn(),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs') as typeof import('fs');
  return {
    ...actual,
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
  };
});

import { LettersService } from './letters.service';

describe('LettersService.generateSystemLetter draft-until-send', () => {
  const employeeId = 'emp-1';

  function build() {
    const created: { status?: LetterStatus } = {};
    const tx = {
      letter: {
        create: jest.fn().mockImplementation(async ({ data }: { data: { status: LetterStatus } }) => {
          created.status = data.status;
          return { id: 'letter-1', ...data };
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'hr-1' }) },
    };

    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: employeeId,
          fullName: 'Test Employee',
          employeeCode: 'E-1',
          phone: '03001234567',
          cnic: '123',
          joiningDate: new Date('2020-01-01'),
          currentDesignation: 'Staff',
          currentBranch: { name: 'Main', address: '' },
          currentDepartment: { name: 'OPD' },
        }),
      },
      letterTemplate: {
        findFirst: jest.fn().mockImplementation(async ({ where }: { where: { code: string } }) => ({
          id: 'tpl-1',
          code: where.code,
          name: where.code,
          requiredVars:
            where.code === 'REINSTATEMENT'
              ? ['reinstatementDate']
              : where.code === 'TERMINATION'
                ? ['terminationReason']
                : [],
          bodyHtml: '<p>{{employeeName}}</p>',
          bodyHtmlEn: null,
          primaryLanguage: 'ur',
          version: 1,
          subjectUr: 'Subject',
          enTitle: null,
          enPrescribed: null,
          enSubtitle: null,
          letterCode: 'X',
        })),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: 9n }]),
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };

    const whatsappService = {
      deliverAfterLetterGenerated: jest.fn().mockResolvedValue(undefined),
    };

    const service = new LettersService(
      prisma as never,
      { assertEmployeeAccess: jest.fn() } as never,
      whatsappService as never,
    );

    return { service, tx, whatsappService, created };
  }

  it('keeps REINSTATEMENT as DRAFT and does not WhatsApp or notify', async () => {
    const { service, tx, whatsappService, created } = build();

    await service.generateSystemLetter(
      {
        employeeId,
        letterType: LetterType.REINSTATEMENT,
        extraFields: { reinstatementDate: '26/08/2026' },
      },
      'user-hr',
    );

    expect(created.status).toBe(LetterStatus.DRAFT);
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(whatsappService.deliverAfterLetterGenerated).not.toHaveBeenCalled();
  });

  it('keeps TERMINATION as DRAFT and does not WhatsApp or notify', async () => {
    const { service, tx, whatsappService, created } = build();

    await service.generateSystemLetter(
      {
        employeeId,
        letterType: LetterType.TERMINATION,
        extraFields: { terminationReason: 'Inquiry' },
      },
      'user-hr',
    );

    expect(created.status).toBe(LetterStatus.DRAFT);
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(whatsappService.deliverAfterLetterGenerated).not.toHaveBeenCalled();
  });

  it('keeps EXPLANATION as DRAFT and does not WhatsApp or notify', async () => {
    const { service, tx, whatsappService, created } = build();

    await service.generateSystemLetter(
      {
        employeeId,
        letterType: LetterType.EXPLANATION,
        extraFields: { violations: 'Absence on 12/08/2026' },
      },
      'user-hr',
    );

    expect(created.status).toBe(LetterStatus.DRAFT);
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(whatsappService.deliverAfterLetterGenerated).not.toHaveBeenCalled();
  });

  it('auto-sends SUSPENSION_ELIGIBILITY as SENT with eligibility wording', async () => {
    const { service, tx, whatsappService, created } = build();
    tx.user = {
      findFirst: jest.fn().mockResolvedValue({ id: 'hr-1' }),
    };

    await service.generateSystemLetter(
      {
        employeeId,
        letterType: LetterType.SUSPENSION_ELIGIBILITY,
        extraFields: {
          eligibilityPeriod: '2026-08',
          violationRows: [
            {
              serial: 1,
              nameUr: 'تاخیر از حاضری',
              count: 9,
              dates: '01/08/2026',
              detail: 'ماہ 2026-08 — 9 یوم',
            },
          ],
        },
      },
      'SYSTEM',
    );

    expect(created.status).toBe(LetterStatus.SENT);
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SUSPENSION_ELIGIBILITY_NOTICE_ISSUED',
          userId: 'hr-1',
        }),
      }),
    );
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'LETTER_ISSUED',
          message: expect.stringMatching(/pre-suspension eligibility|not been suspended/i),
        }),
      }),
    );
    expect(whatsappService.deliverAfterLetterGenerated).toHaveBeenCalledWith(
      expect.objectContaining({
        letterType: LetterType.SUSPENSION_ELIGIBILITY,
      }),
    );
  });

  it('auto-sends NEAR_SUSPENSION_WARNING as SENT with warning wording', async () => {
    const { service, tx, whatsappService, created } = build();

    await service.generateSystemLetter(
      {
        employeeId,
        letterType: LetterType.NEAR_SUSPENSION_WARNING,
        extraFields: {
          warningPeriod: '2026-08',
          violationRows: [
            {
              serial: 1,
              nameUr: 'تاخیر از حاضری',
              count: 7,
              dates: '01/08/2026',
              detail: 'ماہ 2026-08 — 7 یوم',
            },
          ],
        },
      },
      'SYSTEM',
    );

    expect(created.status).toBe(LetterStatus.SENT);
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'NEAR_SUSPENSION_WARNING_ISSUED',
        }),
      }),
    );
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'LETTER_ISSUED',
          message: expect.stringMatching(
            /approaching suspension|not been suspended/i,
          ),
        }),
      }),
    );
    expect(whatsappService.deliverAfterLetterGenerated).toHaveBeenCalledTimes(1);
    expect(whatsappService.deliverAfterLetterGenerated).toHaveBeenCalledWith(
      expect.objectContaining({
        letterType: LetterType.NEAR_SUSPENSION_WARNING,
      }),
    );
  });

  it('rejects manual generate of system watchlist letter types', async () => {
    const { service } = build();

    await expect(
      service.generate(
        {
          employeeId,
          letterType: LetterType.NEAR_SUSPENSION_WARNING,
        },
        'user-hr',
      ),
    ).rejects.toThrow(/system-generated/);

    await expect(
      service.generate(
        {
          employeeId,
          letterType: LetterType.SUSPENSION_ELIGIBILITY,
        },
        'user-hr',
      ),
    ).rejects.toThrow(/system-generated/);
  });
});

describe('LettersService.findAll portal visibility', () => {
  it('hides DRAFT from the employee portal and lists SENT', async () => {
    const prisma = {
      letter: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sent-1', status: LetterStatus.SENT }]),
      },
    };
    const service = new LettersService(
      prisma as never,
      { assertEmployeeAccess: jest.fn() } as never,
      { deliverAfterLetterGenerated: jest.fn() } as never,
    );

    await service.findAll({}, { id: 'emp-user', role: UserRole.EMPLOYEE, portalOnly: true });

    expect(prisma.letter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: LetterStatus.SENT }),
      }),
    );
  });
});
