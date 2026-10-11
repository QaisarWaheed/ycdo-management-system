jest.mock('./package-allowances.util', () => ({
  ...jest.requireActual('./package-allowances.util'),
  syncLegacyAllowanceRows: jest.fn(),
}));

import { AllowancesService } from './allowances.service';
import { syncLegacyAllowanceRows } from './package-allowances.util';

const petrol = {
  id: 'petrol',
  name: 'Petrol',
  isActive: true,
  legacyField: 'fuelAllowance',
};
const travel = {
  id: 'travel',
  name: 'Travelling Exp',
  isActive: true,
  legacyField: null,
};

function build({
  packageFrom = new Date(Date.UTC(2026, 0, 1)),
  closedEntry = null as { id: string } | null,
} = {}) {
  const open = {
    id: 'sr-1',
    employeeId: 'e1',
    basicStipend: 30000,
    fuelAllowance: 5000,
    effectiveFrom: packageFrom,
    effectiveTo: null,
  };
  const prisma = {
    payAllowanceType: {
      findUnique: jest.fn(async ({ where }) =>
        where.id === 'petrol' ? petrol : travel,
      ),
    },
    employee: { findUnique: jest.fn().mockResolvedValue({ id: 'e1' }) },
    employeeAllowance: { findMany: jest.fn().mockResolvedValue([]) },
    payrollEntry: { findFirst: jest.fn().mockResolvedValue(closedEntry) },
    stipendRecord: { findFirst: jest.fn().mockResolvedValue(open) },
    auditLog: { create: jest.fn() },
  };
  const payroll = {
    salaryIncrement: jest.fn().mockResolvedValue({ id: 'sr-2' }),
    updateActiveStipend: jest.fn().mockResolvedValue({ id: 'sr-1' }),
    recomputeEmployeeMonth: jest.fn(),
  };
  const service = new AllowancesService(prisma as never, payroll as never);
  return { service, prisma, payroll };
}

const sept = (extra: Record<string, unknown> = {}) => ({
  employeeId: 'e1',
  typeId: 'petrol',
  amount: 10000,
  startMonth: '2026-09',
  note: 'September petrol',
  ...extra,
});

describe('allowance change for a month before the switch-over', () => {
  it('starts a new stipend package from that month with the new amount', async () => {
    const { service, payroll } = build();
    await service.assign(sept() as never, { id: 'u1' });
    expect(payroll.salaryIncrement).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: 'e1',
        basicStipend: 30000,
        fuelAllowance: 10000,
        effectiveFrom: new Date(Date.UTC(2026, 8, 1)).toISOString(),
      }),
      'u1',
    );
    expect(syncLegacyAllowanceRows).toHaveBeenCalled();
  });

  it('edits the open package in place when it already starts that month', async () => {
    const { service, payroll } = build({
      packageFrom: new Date(Date.UTC(2026, 8, 1)),
    });
    await service.assign(sept() as never, { id: 'u1' });
    expect(payroll.salaryIncrement).not.toHaveBeenCalled();
    expect(payroll.updateActiveStipend).toHaveBeenCalledWith(
      expect.objectContaining({ fuelAllowance: 10000 }),
      'u1',
    );
  });

  it('refuses a month whose payroll is already processed or paid', async () => {
    const { service, payroll } = build({ closedEntry: { id: 'pe-1' } });
    await expect(service.assign(sept() as never, { id: 'u1' })).rejects.toThrow(
      /already processed or paid/,
    );
    expect(payroll.salaryIncrement).not.toHaveBeenCalled();
  });

  it('refuses a "To month" for package fields', async () => {
    const { service } = build();
    await expect(
      service.assign(sept({ endMonth: '2026-09' }) as never, { id: 'u1' }),
    ).rejects.toThrow(/"To month" is not available/);
  });

  it('types that are not package fields (Incharge, Admin…) use the allowance table from that month', async () => {
    const { service, prisma, payroll } = build();
    const create = jest.fn().mockResolvedValue({ id: 'ea-1' });
    Object.assign(prisma, {
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ employeeAllowance: { create, update: jest.fn() } }),
      ),
    });
    Object.assign(prisma.payrollEntry, {
      findMany: jest.fn().mockResolvedValue([{ month: 10, year: 2026 }]),
    });
    await service.assign(
      sept({ typeId: 'travel', startMonth: '2026-10', amount: 5000 }) as never,
      { id: 'u1' },
    );
    expect(payroll.salaryIncrement).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        typeId: 'travel',
        amount: 5000,
        startMonth: new Date(Date.UTC(2026, 9, 1)),
      }),
    });
    expect(payroll.recomputeEmployeeMonth).toHaveBeenCalledWith({
      employeeId: 'e1',
      month: 10,
      year: 2026,
    });
  });

  it('moves an allowance start earlier ("from Oct" for one set from Nov)', async () => {
    const { service, prisma } = build();
    const update = jest.fn().mockResolvedValue({ id: 'ea-nov' });
    Object.assign(prisma.employeeAllowance, {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            id: 'ea-nov',
            amount: 5000,
            startMonth: new Date(Date.UTC(2026, 10, 1)),
            endMonth: null,
          },
        ]),
      update,
    });
    Object.assign(prisma.payrollEntry, {
      findMany: jest.fn().mockResolvedValue([]),
    });
    await service.assign(
      sept({ typeId: 'travel', startMonth: '2026-10', amount: 5000 }) as never,
      { id: 'u1' },
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'ea-nov' },
      data: { startMonth: new Date(Date.UTC(2026, 9, 1)) },
    });
  });

  it('refuses a month already processed for types on the allowance table', async () => {
    const { service } = build({ closedEntry: { id: 'pe' } });
    await expect(
      service.assign(sept({ typeId: 'travel' }) as never, { id: 'u1' }),
    ).rejects.toThrow(/already processed or paid/);
  });

  it('compares an approval request against the package amount', async () => {
    const { service } = build();
    const res = await service.describeAssign(sept() as never);
    expect(res.isIncrease).toBe(true);
    expect(res.summary).toContain('Petrol');
  });
});
