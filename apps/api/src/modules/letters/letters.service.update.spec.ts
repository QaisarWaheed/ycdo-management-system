import { BadRequestException } from '@nestjs/common';
import {
  EmployeeStatus,
  LetterStatus,
  LetterType,
  SuspensionRequestStatus,
  UserRole,
} from '@prisma/client';

jest.mock('./pdf.helper', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

jest.mock('../../config/cloudinary.config', () => ({
  isCloudinaryEnabled: () => false,
  uploadPdfToCloudinary: jest.fn(),
}));

import { generatePdf } from './pdf.helper';
import { LettersService } from './letters.service';

describe('LettersService.updateLetter', () => {
  const letterId = 'letter-1';
  const employeeId = 'emp-1';
  const actingUserId = 'user-hr';

  function build(
    status: LetterStatus,
    letterType: LetterType = LetterType.WARNING,
  ) {
    const letter = {
      id: letterId,
      employeeId,
      letterType,
      status,
      letterNo: '1/YCDO/2026',
      templateCode: letterType,
      content: { violations: 'old reason' },
      variables: { violations: ['old reason'] },
      employee: {
        id: employeeId,
        fullName: 'Test Employee',
        employeeCode: 'E-1',
        currentDesignation: 'Staff',
      },
      acknowledgement: null,
      replies: [],
    };

    const tx = {
      letter: {
        update: jest.fn().mockResolvedValue({
          ...letter,
          status,
          content: { violations: 'new reason' },
        }),
      },
      employee: { update: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      letter: { findUnique: jest.fn().mockResolvedValue(letter) },
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: employeeId,
          fullName: 'Test Employee',
          employeeCode: 'E-1',
          cnic: '',
          phone: '0300',
          currentDesignation: 'Staff',
          joiningDate: null,
          gender: 'MALE',
          currentBranch: { name: 'HQ', address: null },
          currentDepartment: { name: 'OPD' },
        }),
      },
      letterTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          code: letterType,
          name: letterType,
          bodyHtml: '<p>{{violations}}</p>',
          version: 1,
          requiredVars: [],
          letterCode: 'W',
          primaryLanguage: 'ur',
          subjectUr: null,
          enTitle: null,
          enPrescribed: null,
          enSubtitle: null,
        }),
      },
      suspensionRequest: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
    };

    const service = new LettersService(
      prisma as never,
      { assertEmployeeAccess: jest.fn().mockResolvedValue(undefined) } as never,
      { deliverAfterLetterGenerated: jest.fn() } as never,
    );

    return { service, prisma, tx, letter };
  }

  it('updates extraFields on a DRAFT letter and keeps DRAFT status', async () => {
    const { service, tx } = build(LetterStatus.DRAFT);

    await service.updateLetter(
      letterId,
      { extraFields: { violations: 'updated wording' } },
      actingUserId,
      UserRole.HR_MANAGER,
    );

    expect(generatePdf).toHaveBeenCalled();
    expect(tx.letter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: letterId },
        data: expect.objectContaining({
          content: expect.objectContaining({
            violations: 'updated wording',
          }),
        }),
      }),
    );
    const updateData = tx.letter.update.mock.calls[0][0].data;
    expect(updateData.status).toBeUndefined();
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'LETTER_UPDATED' }),
      }),
    );
  });

  it('rejects editing a SENT letter and does not persist content', async () => {
    const { service, tx } = build(LetterStatus.SENT);

    await expect(
      service.updateLetter(
        letterId,
        { extraFields: { violations: 'tamper' } },
        actingUserId,
        UserRole.HR_MANAGER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.letter.update).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('rejects editing a REVERSED letter and does not persist content', async () => {
    const { service, tx } = build(LetterStatus.REVERSED);

    await expect(
      service.updateLetter(
        letterId,
        { extraFields: { violations: 'tamper' } },
        actingUserId,
        UserRole.HR_MANAGER,
      ),
    ).rejects.toThrow(/reversed/i);

    expect(tx.letter.update).not.toHaveBeenCalled();
  });

  it('does not change employee status when editing a DRAFT SUSPENSION letter', async () => {
    const { service, tx } = build(LetterStatus.DRAFT, LetterType.SUSPENSION);

    await service.updateLetter(
      letterId,
      { extraFields: { suspensionReason: 'revised reason' } },
      actingUserId,
      UserRole.HR_MANAGER,
    );

    expect(tx.letter.update).toHaveBeenCalled();
    const updateData = tx.letter.update.mock.calls[0][0].data;
    expect(updateData.status).toBeUndefined();
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: EmployeeStatus.SUSPENDED },
      }),
    );
  });

  it('allows editing a DRAFT suspension letter while the request is DRAFT', async () => {
    const { service, prisma, tx } = build(
      LetterStatus.DRAFT,
      LetterType.SUSPENSION,
    );
    prisma.suspensionRequest.findUnique.mockResolvedValue({
      status: SuspensionRequestStatus.DRAFT,
    });

    await service.updateLetter(
      letterId,
      { extraFields: { suspensionReason: 'revised' } },
      actingUserId,
      UserRole.HR_MANAGER,
    );

    expect(tx.letter.update).toHaveBeenCalled();
  });

  it('rejects editing a DRAFT suspension letter while the request is PENDING_APPROVAL', async () => {
    const { service, prisma, tx } = build(
      LetterStatus.DRAFT,
      LetterType.SUSPENSION,
    );
    prisma.suspensionRequest.findUnique.mockResolvedValue({
      status: SuspensionRequestStatus.PENDING_APPROVAL,
    });

    await expect(
      service.updateLetter(
        letterId,
        { extraFields: { suspensionReason: 'tamper' } },
        actingUserId,
        UserRole.HR_MANAGER,
      ),
    ).rejects.toThrow(/pending approval or approved/i);

    expect(tx.letter.update).not.toHaveBeenCalled();
  });

  it('rejects editing a DRAFT suspension letter while the request is APPROVED', async () => {
    const { service, prisma, tx } = build(
      LetterStatus.DRAFT,
      LetterType.SUSPENSION,
    );
    prisma.suspensionRequest.findUnique.mockResolvedValue({
      status: SuspensionRequestStatus.APPROVED,
    });

    await expect(
      service.updateLetter(
        letterId,
        { extraFields: { suspensionReason: 'tamper' } },
        actingUserId,
        UserRole.HR_MANAGER,
      ),
    ).rejects.toThrow(/pending approval or approved/i);

    expect(tx.letter.update).not.toHaveBeenCalled();
  });

  it('allows editing a DRAFT suspension letter after the request is REJECTED', async () => {
    const { service, prisma, tx } = build(
      LetterStatus.DRAFT,
      LetterType.SUSPENSION,
    );
    prisma.suspensionRequest.findUnique.mockResolvedValue({
      status: SuspensionRequestStatus.REJECTED,
    });

    await service.updateLetter(
      letterId,
      { extraFields: { suspensionReason: 'revised after rejection' } },
      actingUserId,
      UserRole.HR_MANAGER,
    );

    expect(tx.letter.update).toHaveBeenCalled();
  });

  it('still allows editing an unrelated DRAFT letter', async () => {
    const { service, prisma, tx } = build(LetterStatus.DRAFT, LetterType.WARNING);
    prisma.suspensionRequest.findUnique.mockResolvedValue(null);

    await service.updateLetter(
      letterId,
      { extraFields: { violations: 'ok' } },
      actingUserId,
      UserRole.HR_MANAGER,
    );

    expect(tx.letter.update).toHaveBeenCalled();
  });
});
