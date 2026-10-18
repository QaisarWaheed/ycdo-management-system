import { BadRequestException } from '@nestjs/common';
import { PayrollAmendmentStatus, PayrollStatus } from '@prisma/client';
import { PayrollAmendmentService } from './payroll-amendment.service';

function setup(entryStatus: PayrollStatus, reqStatus = PayrollAmendmentStatus.SUBMITTED) {
  const tx = {
    payrollAmendmentRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    payrollEntry: {
      updateMany: jest.fn().mockResolvedValue({ count: entryStatus === PayrollStatus.VERIFIED ? 1 : 0 }),
    },
    payrollChangeLog: { create: jest.fn() },
  };
  const prisma = {
    payrollEntry: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'p1',
        status: entryStatus,
        month: 10,
        year: 2026,
        stipendRecord: { employeeId: 'e1', employee: { fullName: 'A' } },
      }),
    },
    payrollAmendmentRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({
        id: 'r1',
        status: reqStatus,
        payrollEntryId: 'p1',
        employeeId: 'e1',
        month: 10,
        year: 2026,
        notification: 'Wrong fine',
      }),
      create: jest.fn().mockResolvedValue({ id: 'r1', employeeId: 'e1', notification: 'Wrong fine' }),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((fn) => fn(tx)),
  };
  return { service: new PayrollAmendmentService(prisma as never), tx };
}

describe('Req 12 verified slip amendments', () => {
  it('HR can only raise an amendment on a verified slip', async () => {
    await expect(
      setup(PayrollStatus.PENDING).service.notify({ payrollEntryId: 'p1', notification: 'Wrong fine' }, { id: 'hr' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Founder approval reopens the verified slip to Pending for Finance', async () => {
    const { service, tx } = setup(PayrollStatus.VERIFIED);
    await service.decide('r1', true, undefined, { id: 'founder' });
    expect(tx.payrollEntry.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'p1', status: PayrollStatus.VERIFIED },
      data: { status: PayrollStatus.PENDING, financeVerifiedAt: null },
    });
  });

  it('Founder rejection leaves the slip untouched', async () => {
    const { service, tx } = setup(PayrollStatus.VERIFIED);
    await service.decide('r1', false, 'no', { id: 'founder' });
    expect(tx.payrollEntry.updateMany).not.toHaveBeenCalled();
  });
});
