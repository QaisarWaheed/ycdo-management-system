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
