import { LetterStatus, LetterType } from '@prisma/client';

jest.mock('./pdf.helper', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

import { issueAutoTemplatedLetter } from './auto-letter.helper';

describe('issueAutoTemplatedLetter', () => {
  function makeDb() {
    return {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          fullName: 'Ali Khan',
          employeeCode: 'E-1',
          currentDesignation: 'Staff',
          cnic: '123',
          currentBranch: { name: 'Main' },
          currentDepartment: { name: 'OPD' },
        }),
      },
      letterTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: 41n }]),
      letter: { create: jest.fn().mockResolvedValue({ id: 'let-1' }) },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'hr-1', employeeId: 'hr-emp' },
        ]),
      },
      notification: { create: jest.fn().mockResolvedValue({}) },
    };
  }

  it('creates a DRAFT letter and notifies HR, not the employee', async () => {
    const db = makeDb();

    await issueAutoTemplatedLetter(db as never, {
      employeeId: 'emp-1',
      letterType: LetterType.ADVICE,
      extraFields: { violations: 'Late arrival', incidentDate: '2026-08-12' },
      notificationMessage: 'Draft advice letter is ready for proofread and send.',
      notificationType: 'DRAFT_LETTER_READY',
    });

    expect(db.letter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          letterType: LetterType.ADVICE,
          status: LetterStatus.DRAFT,
          requiresAcknowledgement: false,
        }),
      }),
    );
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeId: 'hr-emp',
          type: 'DRAFT_LETTER_READY',
        }),
      }),
    );
  });

  it('refuses automatic suspension letters', async () => {
    const db = makeDb();

    await expect(
      issueAutoTemplatedLetter(db as never, {
        employeeId: 'emp-1',
        letterType: LetterType.SUSPENSION,
        extraFields: {},
        notificationMessage: 'no',
        notificationType: 'SUSPENSION_ISSUED',
      }),
    ).rejects.toThrow(/Automatic SENT suspension letters are not allowed/);

    expect(db.letter.create).not.toHaveBeenCalled();
  });
});
