import { EmployeeStatus } from '@prisma/client';
import { IncentivesService } from './incentives.service';
import { incentiveAllowanceDescription } from './incentives.dto';

describe('IncentivesService payroll locking', () => {
  const incentive = {
    id: 'incentive-1', employeeId: 'employee-1', amount: 100,
    month: 9, year: 2026, reason: 'Good work',
  };

  function build() {
    let unlock!: () => void;
    let lockRequested!: () => void;
    const lockStarted = new Promise<void>((resolve) => { lockRequested = resolve; });
    const lock = new Promise<void>((resolve) => { unlock = resolve; });
    const entry = {
      id: 'payroll-1',
      allowances: [{ id: 'allowance-1', description: incentiveAllowanceDescription(incentive.reason) }],
    };
    const tx = {
      $queryRaw: jest.fn(async () => { lockRequested(); await lock; return []; }),
      employee: { findUnique: jest.fn().mockResolvedValue({ status: EmployeeStatus.ACTIVE }) },
      stipendRecord: { findFirst: jest.fn().mockResolvedValue({ id: 'stipend-1' }) },
      incentive: {
        findUnique: jest.fn().mockResolvedValue(incentive),
        create: jest.fn().mockResolvedValue(incentive),
        delete: jest.fn().mockResolvedValue(incentive),
      },
      payrollEntry: {
        findUnique: jest.fn().mockResolvedValue(entry),
        findFirst: jest.fn().mockResolvedValue(entry),
        update: jest.fn().mockResolvedValue(entry),
      },
      allowance: { create: jest.fn(), delete: jest.fn() },
      notification: { create: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      incentive: { findUnique: jest.fn().mockResolvedValue(incentive) },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = new IncentivesService(prisma as never, {
      assertEmployeeAccess: jest.fn(),
    } as never);
    return { service, prisma, tx, unlock, lockStarted };
  }

  it('waits for the payroll employee lock before reading or incrementing financial records', async () => {
    const { service, prisma, tx, unlock, lockStarted } = build();
    const result = service.create(incentive, 'manager-1');
    await lockStarted;
    expect(tx.stipendRecord.findFirst).not.toHaveBeenCalled();
    expect(tx.incentive.create).not.toHaveBeenCalled();
    expect(tx.payrollEntry.update).not.toHaveBeenCalled();
    unlock();
    await expect(result).resolves.toEqual(incentive);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }));
    expect(tx.$queryRaw).toHaveBeenCalledWith(expect.any(Array), incentive.employeeId);
    expect(tx.payrollEntry.update).toHaveBeenCalledWith({
      where: { id: 'payroll-1' },
      data: { totalAllowances: { increment: 100 }, netStipend: { increment: 100 } },
    });
  });

  it('rereads deletion state after the lock and rejects an incentive already removed by another writer', async () => {
    const { service, tx, unlock, lockStarted } = build();
    const result = service.delete(incentive.id, 'manager-1');
    await lockStarted;
    expect(tx.incentive.findUnique).not.toHaveBeenCalled();
    expect(tx.payrollEntry.findFirst).not.toHaveBeenCalled();
    tx.incentive.findUnique.mockResolvedValue(null);
    unlock();
    await expect(result).rejects.toThrow('Incentive with id incentive-1 not found');
    expect(tx.allowance.delete).not.toHaveBeenCalled();
    expect(tx.payrollEntry.update).not.toHaveBeenCalled();
  });
});
