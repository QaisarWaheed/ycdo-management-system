import { NotFoundException } from '@nestjs/common';
import { LetterStatus, UserRole } from '@prisma/client';

jest.mock('./pdf.helper', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

jest.mock('../../config/cloudinary.config', () => ({
  isCloudinaryEnabled: () => false,
  uploadPdfToCloudinary: jest.fn(),
}));

import { isOwnLettersOnlyActor, LettersService } from './letters.service';

describe('Finance / Progress Officer own-letters scope', () => {
  const letterId = 'letter-1';
  const finance = { id: 'user-finance', role: UserRole.PAYROLL_OFFICER };
  const progress = { id: 'user-progress', role: UserRole.PROGRESS_OFFICER };

  function build(letter: Record<string, unknown> | null) {
    const prisma = {
      letter: {
        findUnique: jest.fn().mockResolvedValue(letter),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const accessScope = {
      assertEmployeeAccess: jest.fn(),
      narrowEmployeeWhereForActor: jest.fn().mockResolvedValue({}),
    };
    const service = new LettersService(
      prisma as never,
      accessScope as never,
      { deliverAfterLetterGenerated: jest.fn() } as never,
    );
    return { service, prisma, accessScope };
  }

  const letterBy = (createdById: string | null) => ({
    id: letterId,
    employeeId: 'emp-1',
    status: LetterStatus.DRAFT,
    createdById,
    employee: { id: 'emp-1', fullName: 'A', phone: null },
    acknowledgement: null,
    replies: [],
  });

  it('classifies only pure Finance / Progress logins as own-letters-only', () => {
    expect(isOwnLettersOnlyActor(finance)).toBe(true);
    expect(isOwnLettersOnlyActor(progress)).toBe(true);
    expect(
      isOwnLettersOnlyActor({
        role: UserRole.PAYROLL_OFFICER,
        roles: [UserRole.PAYROLL_OFFICER, UserRole.HR_MANAGER],
      }),
    ).toBe(false);
    expect(isOwnLettersOnlyActor({ role: UserRole.HR_MANAGER })).toBe(false);
  });

  it('lists only letters the Finance login created', async () => {
    const { service, prisma } = build(null);
    await service.findAll({} as never, finance);
    expect(prisma.letter.findMany.mock.calls[0][0].where.createdById).toBe(
      finance.id,
    );
  });

  it('does not narrow the list for HR roles', async () => {
    const { service, prisma } = build(null);
    await service.findAll({} as never, { id: 'hr', role: UserRole.HR_MANAGER });
    expect(prisma.letter.findMany.mock.calls[0][0].where.createdById).toBe(
      undefined,
    );
  });

  it('Progress Officer cannot open a letter created by someone else', async () => {
    const { service } = build(letterBy('someone-else'));
    await expect(service.findOne(letterId, progress)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('Progress Officer can open their own letter', async () => {
    const { service } = build(letterBy(progress.id));
    await expect(service.findOne(letterId, progress)).resolves.toMatchObject({
      id: letterId,
    });
  });

  it('Finance cannot send a letter created by someone else', async () => {
    const { service, accessScope } = build(letterBy('someone-else'));
    await expect(
      service.sendLetter(letterId, finance.id, finance.role),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(accessScope.assertEmployeeAccess).not.toHaveBeenCalled();
  });

  it('Finance cannot share a system-generated letter on WhatsApp', async () => {
    const { service } = build(letterBy(null));
    await expect(
      service.getWhatsAppShare(letterId, finance),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
