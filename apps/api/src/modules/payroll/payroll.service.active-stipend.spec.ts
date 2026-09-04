jest.mock('exceljs', () => ({ __esModule: true, default: class ExcelJS {} }), {
  virtual: true,
});

jest.mock('../attendance/discipline.helper', () => ({
  repairLateDisciplineForPayrollMonth: jest.fn().mockResolvedValue({
    applied: 0,
    repaired: 0,
    skipped: 0,
  }),
}));

import { PayrollStatus } from '@prisma/client';
import { PayrollService } from './payroll.service';

describe('PayrollService.updateActiveStipend', () => {
  it('updates the open package in place and does not create a new stipend', async () => {
    const active = {
      id: 'sr-open',
      basicStipend: 30000,
      allowances: 5000,
      effectiveFrom: new Date('2021-02-21T00:00:00.000Z'),
    };
    const stipendUpdate = jest.fn().mockResolvedValue({
      ...active,
      basicStipend: 32000,
      lumpsumTotal: 37000,
    });
    const stipendCreate = jest.fn();
    const auditCreate = jest.fn();
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          stipendRecords: [active],
        }),
      },
      stipendRecord: { update: stipendUpdate, create: stipendCreate },
      auditLog: { create: auditCreate },
      payrollEntry: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({
          stipendRecord: { update: stipendUpdate, create: stipendCreate },
          auditLog: { create: auditCreate },
        }),
    };
    const service = new PayrollService(prisma as never, {} as never);

    const updated = await service.updateActiveStipend(
      {
        employeeId: 'emp-1',
        basicStipend: 32000,
        allowances: 5000,
        reason: 'Correct package amounts',
      },
      'user-1',
    );

    expect(stipendCreate).not.toHaveBeenCalled();
    expect(stipendUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sr-open' },
        data: expect.objectContaining({
          basicStipend: 32000,
          allowances: 5000,
          lumpsumTotal: 37000,
        }),
      }),
    );
    expect(updated.basicStipend).toBe(32000);
    expect(prisma.payrollEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: PayrollStatus.PENDING,
          stipendRecord: { employeeId: 'emp-1' },
        },
      }),
    );
  });
});
