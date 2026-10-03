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
  it('preserves explicit-date correction of the open package in place', async () => {
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
    const stipendUpdateMany = jest.fn();
    const auditCreate = jest.fn();
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          stipendRecords: [active],
        }),
      },
      stipendRecord: {
        findMany: jest.fn().mockResolvedValue([{ ...active, effectiveTo: null }, { id: 'prior', effectiveFrom: new Date('2020-01-01'), effectiveTo: active.effectiveFrom }]),
        update: stipendUpdate,
        create: stipendCreate,
        updateMany: stipendUpdateMany,
      },
      auditLog: { create: auditCreate },
      payrollEntry: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(prisma),
    };
    const service = new PayrollService(prisma as never, {} as never);

    const updated = await service.updateActiveStipend(
      {
        employeeId: 'emp-1',
        basicStipend: 32000,
        allowances: 5000,
        effectiveFrom: '2021-02-21',
        reason: 'Correct package amounts',
      },
      'user-1',
    );

    expect(stipendCreate).not.toHaveBeenCalled();
    expect(stipendUpdateMany).not.toHaveBeenCalled();
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

  it('moves open package start date and prior seam without creating a new package', async () => {
    const previousFrom = new Date('2026-08-28T00:00:00.000Z');
    const monthStart = new Date('2026-08-01T00:00:00.000Z');
    const active = {
      id: 'sr-open',
      basicStipend: 30000,
      allowances: 5000,
      effectiveFrom: previousFrom,
    };
    const stipendUpdate = jest.fn().mockResolvedValue({
      ...active,
      effectiveFrom: monthStart,
      lumpsumTotal: 35000,
    });
    const stipendCreate = jest.fn();
    const stipendUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const auditCreate = jest.fn();
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          stipendRecords: [active],
        }),
      },
      stipendRecord: {
        findMany: jest.fn().mockResolvedValue([{ ...active, effectiveTo: null }, { id: 'prior', effectiveFrom: new Date('2020-01-01'), effectiveTo: active.effectiveFrom }]),
        update: stipendUpdate,
        create: stipendCreate,
        updateMany: stipendUpdateMany,
      },
      auditLog: { create: auditCreate },
      payrollEntry: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(prisma),
    };
    const service = new PayrollService(prisma as never, {} as never);

    await service.updateActiveStipend(
      {
        employeeId: 'emp-1',
        basicStipend: 30000,
        allowances: 5000,
        effectiveFrom: '2026-08-01',
        reason: 'Management order — raise from month day 1',
      },
      'user-1',
    );

    expect(stipendCreate).not.toHaveBeenCalled();
    expect(stipendUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employeeId: 'emp-1',
          id: { not: 'sr-open' },
          effectiveTo: previousFrom,
        }),
        data: { effectiveTo: monthStart },
      }),
    );
    expect(stipendUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sr-open' },
        data: expect.objectContaining({
          effectiveFrom: monthStart,
        }),
      }),
    );
  });

  it('dated correction only recomputes months from the earlier start date on', async () => {
    const previousFrom = new Date('2026-08-01T00:00:00.000Z');
    const active = {
      id: 'sr-open',
      basicStipend: 30000,
      allowances: 5000,
      effectiveFrom: previousFrom,
    };
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          stipendRecords: [active],
        }),
      },
      stipendRecord: {
        findMany: jest.fn().mockResolvedValue([
          { ...active, effectiveTo: null },
          { id: 'prior', effectiveFrom: new Date('2020-01-01'), effectiveTo: previousFrom },
        ]),
        update: jest.fn().mockResolvedValue({ ...active, lumpsumTotal: 40000 }),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn() },
      // July is PENDING with an incomplete card; the edit starts in August.
      payrollEntry: {
        findMany: jest.fn().mockResolvedValue([
          { month: 7, year: 2026 },
          { month: 8, year: 2026 },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(prisma),
    };
    const service = new PayrollService(prisma as never, {} as never);
    // The save runs on a transaction-bound copy of the service, so spy on the prototype.
    const recompute = jest
      .spyOn(
        PayrollService.prototype as never as {
          recomputeEmployeeMonth: () => Promise<void>;
        },
        'recomputeEmployeeMonth',
      )
      .mockResolvedValue(undefined);

    await service.updateActiveStipend(
      {
        employeeId: 'emp-1',
        basicStipend: 35000,
        allowances: 5000,
        effectiveFrom: '2026-08-01',
        reason: 'Correct August package',
      },
      'user-1',
    );

    expect(recompute).toHaveBeenCalledTimes(1);
    expect(recompute).toHaveBeenCalledWith(
      expect.objectContaining({ month: 8, year: 2026 }),
    );
    recompute.mockRestore();
  });
});
