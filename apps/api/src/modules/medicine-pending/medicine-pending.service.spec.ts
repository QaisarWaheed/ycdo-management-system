import { MedicinePendingService } from './medicine-pending.service';
import { medicinePendingDescription } from './medicine-pending.util';

function setup(frozen: boolean) {
  const prisma = {
    employee: { findUnique: jest.fn().mockResolvedValue({ id: 'e1' }) },
    payrollEntry: { findFirst: jest.fn().mockResolvedValue(frozen ? { id: 'p1' } : null) },
    medicinePendingEntry: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data })),
    },
    auditLog: { create: jest.fn() },
  };
  const payroll = { recomputeEmployeeMonth: jest.fn() };
  return { prisma, payroll, service: new MedicinePendingService(prisma as never, payroll as never) };
}

const dto = { employeeId: 'e1', tokenNo: ' 125 ', amount: 850, pendingDate: '2026-10-05' };

describe('Medicine Pending', () => {
  it('saves the entry and recomputes that month so the deduction shows at once', async () => {
    const { service, prisma, payroll } = setup(false);
    const saved = await service.create(dto, 'fin');
    expect(saved).toMatchObject({ tokenNo: '125', amount: 850 });
    expect(prisma.medicinePendingEntry.create.mock.calls[0][0].data.pendingDate).toEqual(
      new Date('2026-10-05T00:00:00.000Z'),
    );
    expect(payroll.recomputeEmployeeMonth).toHaveBeenCalledWith({ employeeId: 'e1', month: 10, year: 2026 });
  });

  it('refuses a month whose salary is already verified or paid', async () => {
    const { service, prisma } = setup(true);
    await expect(service.create(dto, 'fin')).rejects.toThrow('already verified or paid');
    expect(prisma.medicinePendingEntry.create).not.toHaveBeenCalled();
  });

  it('labels the payroll row with token and date', () => {
    expect(
      medicinePendingDescription({ id: 'm1', tokenNo: '125', pendingDate: new Date('2026-10-05T00:00:00.000Z') }),
    ).toBe('Medicine pending [m1] Token 125, 2026-10-05');
  });
});
