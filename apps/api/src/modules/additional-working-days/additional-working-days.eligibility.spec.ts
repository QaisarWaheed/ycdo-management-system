import { BadRequestException } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';

jest.mock('../payroll/payroll.service', () => ({
  PayrollService: class PayrollService {},
}));
jest.mock('../letters/letters.service', () => ({
  LettersService: class LettersService {},
}));
jest.mock('../letters/pdf.helper', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

import { AdditionalWorkingDaysService } from './additional-working-days.service';

describe('AdditionalWorkingDaysService eligibility', () => {
  it('create rejects PENDING_APPROVAL', async () => {
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          status: EmployeeStatus.PENDING_APPROVAL,
        }),
      },
      additionalWorkingDay: { create: jest.fn() },
    };
    const service = new AdditionalWorkingDaysService(prisma as never, {
      recomputePendingPayrollForAttendanceDate: jest
        .fn()
        .mockResolvedValue(undefined),
    } as never);

    await expect(
      service.create({ employeeId: 'emp-1', date: '2026-08-20' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.additionalWorkingDay.create).not.toHaveBeenCalled();
  });

  it('upsertFromRelieverSession rejects APPOINTED before creating a row', async () => {
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          status: EmployeeStatus.APPOINTED,
        }),
      },
      additionalWorkingDay: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const service = new AdditionalWorkingDaysService(prisma as never, {
      recomputePendingPayrollForAttendanceDate: jest
        .fn()
        .mockResolvedValue(undefined),
    } as never);

    await expect(
      service.upsertFromRelieverSession({
        relieverSessionId: 'sess-1',
        employeeId: 'emp-1',
        date: new Date(Date.UTC(2026, 7, 20)),
        addedById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.additionalWorkingDay.create).not.toHaveBeenCalled();
  });

  it('upsertFromRelieverSession returns an existing row without re-checking create', async () => {
    const existing = { id: 'awd-1' };
    const prisma = {
      employee: { findUnique: jest.fn() },
      additionalWorkingDay: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
      },
    };
    const service = new AdditionalWorkingDaysService(prisma as never, {
      recomputePendingPayrollForAttendanceDate: jest
        .fn()
        .mockResolvedValue(undefined),
    } as never);

    await expect(
      service.upsertFromRelieverSession({
        relieverSessionId: 'sess-1',
        employeeId: 'emp-1',
        date: new Date(Date.UTC(2026, 7, 20)),
        addedById: 'user-1',
      }),
    ).resolves.toEqual(existing);
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    expect(prisma.additionalWorkingDay.create).not.toHaveBeenCalled();
  });
});
