import { LoanStatus } from '@prisma/client';
import { LoansService } from './loans.service';

function setup(joiningDate: Date) {
  const prisma = {
    employee: { findUnique: jest.fn().mockResolvedValue({ joiningDate }) },
    employeeLoan: {
      create: jest.fn().mockResolvedValue({ id: 'l1' }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'l1',
        employeeId: 'e1',
        status: LoanStatus.PENDING,
        amount: 100000,
        monthlyInstallment: 10000,
        startMonth: new Date('2026-11-01T00:00:00.000Z'),
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    notification: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  return { prisma, service: new LoansService(prisma as never) };
}

const dto = {
  employeeId: 'e1',
  amount: 100000,
  monthlyInstallment: 10000,
  startMonth: '2026-11',
  reason: 'House repair',
};

describe('LoansService', () => {
  it('refuses an application before 6 months of service', async () => {
    const { service, prisma } = setup(new Date());
    await expect(service.create(dto, 'fin')).rejects.toThrow(
      'Not eligible for loan',
    );
    expect(prisma.employeeLoan.create).not.toHaveBeenCalled();
  });

  it('creates the application for an eligible employee, starting on the 1st of the chosen month', async () => {
    const { service, prisma } = setup(new Date('2025-01-01T00:00:00.000Z'));
    await service.create(dto, 'fin');
    expect(prisma.employeeLoan.create.mock.calls[0][0].data.startMonth).toEqual(
      new Date('2026-11-01T00:00:00.000Z'),
    );
  });

  it('approval needs the signed notification and tells the employee', async () => {
    const { service, prisma } = setup(new Date('2025-01-01T00:00:00.000Z'));
    await expect(
      service.approve('l1', undefined, undefined, 'fin'),
    ).rejects.toThrow('signed approval notification');
    await service.approve(
      'l1',
      {
        filename: 'n.jpg',
        originalname: 'n.jpg',
        mimetype: 'image/jpeg',
      } as never,
      'ok',
      'fin',
    );
    expect(prisma.employeeLoan.update.mock.calls[0][0].data).toMatchObject({
      status: LoanStatus.APPROVED,
      notificationUrl: '/uploads/loan-notifications/l1/n.jpg',
    });
    expect(prisma.notification.create).toHaveBeenCalled();
  });
});
