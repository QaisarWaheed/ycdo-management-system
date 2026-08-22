import { BadRequestException } from '@nestjs/common';
import { PayrollStatus } from '@prisma/client';
import { PayrollService } from './payroll.service';

describe('PayrollService.resetUnpaidPayroll / rebuild', () => {
  const user = { id: 'user-1', role: 'SUPER_ADMIN' as const };

  it('rejects reset without the confirm token', async () => {
    const service = new PayrollService({} as any, {} as any);
    await expect(
      service.resetUnpaidPayroll(
        { month: 8, year: 2026, confirm: 'NOPE' as any },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes unpaid entries and leaves PAID counted as skipped', async () => {
    const tx = {
      stipendReceipt: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      payrollDeduction: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      allowance: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      payrollEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      payrollEntry: {
        findMany: jest.fn().mockResolvedValue([{ id: 'pe-1' }, { id: 'pe-2' }]),
        count: jest.fn().mockResolvedValue(3),
      },
      $transaction: jest.fn(async (cb: (client: typeof tx) => Promise<void>) =>
        cb(tx),
      ),
    };
    const service = new PayrollService(prisma as any, {} as any);
    const result = await service.resetUnpaidPayroll(
      { month: 8, year: 2026, confirm: 'RESET_UNPAID_PAYROLL' },
      user,
    );

    expect(result.deleted).toBe(2);
    expect(result.paidSkipped).toBe(3);
    expect(prisma.payrollEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          month: 8,
          year: 2026,
          status: {
            in: [PayrollStatus.PENDING, PayrollStatus.PROCESSED],
          },
        }),
      }),
    );
    expect(tx.payrollEntry.deleteMany).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('rebuilds in employee batches and skips missing stipend packages', async () => {
    const prisma = {
      employee: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          { id: 'emp-1', fullName: 'A', employeeCode: 'A1' },
          { id: 'emp-2', fullName: 'B', employeeCode: 'B1' },
        ]),
      },
    };
    const service = new PayrollService(prisma as any, {
      assertEmployeeAccess: jest.fn(),
    } as any);
    jest
      .spyOn(service, 'createOrGetEntry')
      .mockResolvedValueOnce({ id: 'ok' } as any)
      .mockRejectedValueOnce(
        new Error('No stipend record found covering 8/2026 for B (B1)'),
      );

    const result = await service.rebuildPayrollFromAttendanceAndLetters(
      { month: 8, year: 2026, confirm: 'REBUILD_PAYROLL', limit: 25, offset: 0 },
      user,
    );

    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.hasMore).toBe(false);
  });
});
