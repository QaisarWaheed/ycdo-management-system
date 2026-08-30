import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LetterStatus, UserRole } from '@prisma/client';

jest.mock('./pdf.helper', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

jest.mock('../../config/cloudinary.config', () => ({
  isCloudinaryEnabled: () => false,
  uploadPdfToCloudinary: jest.fn(),
}));

import { LettersService } from './letters.service';

describe('LettersService.findOne / getPdf portal access', () => {
  const ownId = 'emp-1';
  const otherId = 'emp-2';
  const letterId = 'letter-1';

  function build(letter: Record<string, unknown> | null) {
    const prisma = {
      letter: {
        findUnique: jest.fn().mockResolvedValue(letter),
      },
    };
    const service = new LettersService(
      prisma as never,
      { assertEmployeeAccess: jest.fn() } as never,
      { deliverAfterLetterGenerated: jest.fn() } as never,
    );
    return { service, prisma };
  }

  const portalEmployee = {
    id: 'user-emp',
    role: UserRole.EMPLOYEE,
    employeeId: ownId,
    portalOnly: true,
  };

  const hrManager = {
    id: 'user-hr',
    role: UserRole.HR_MANAGER,
    employeeId: 'hr-emp',
  };

  it('employee cannot fetch own DRAFT letter', async () => {
    const { service } = build({
      id: letterId,
      employeeId: ownId,
      status: LetterStatus.DRAFT,
      employee: { id: ownId },
      acknowledgement: null,
      replies: [],
    });

    await expect(service.findOne(letterId, portalEmployee)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('employee cannot fetch another employee SENT letter', async () => {
    const { service } = build({
      id: letterId,
      employeeId: otherId,
      status: LetterStatus.SENT,
      employee: { id: otherId },
      acknowledgement: null,
      replies: [],
    });

    await expect(service.findOne(letterId, portalEmployee)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('employee can fetch own SENT letter', async () => {
    const letter = {
      id: letterId,
      employeeId: ownId,
      status: LetterStatus.SENT,
      employee: { id: ownId },
      acknowledgement: null,
      replies: [],
    };
    const { service } = build(letter);

    await expect(service.findOne(letterId, portalEmployee)).resolves.toEqual(letter);
  });

  it('employee can fetch own REVERSED letter', async () => {
    const letter = {
      id: letterId,
      employeeId: ownId,
      status: LetterStatus.REVERSED,
      employee: { id: ownId },
      acknowledgement: null,
      replies: [],
    };
    const { service } = build(letter);

    await expect(service.findOne(letterId, portalEmployee)).resolves.toEqual(letter);
  });

  it('HR can still fetch DRAFT letters', async () => {
    const letter = {
      id: letterId,
      employeeId: ownId,
      status: LetterStatus.DRAFT,
      employee: { id: ownId },
      acknowledgement: null,
      replies: [],
    };
    const { service } = build(letter);

    await expect(service.findOne(letterId, hrManager)).resolves.toEqual(letter);
  });
});
