import {
  EmployeeStatus,
  IncentiveDuration,
  PayrollStatus,
} from '@prisma/client';
import {
  IncentivesService,
  materializeIncentivePlans,
  planCoversMonth,
} from './incentives.service';

/** Small in-memory Prisma double: plans, incentives, entries and their allowance rows. */
function build() {
  let seq = 0;
  const db = {
    plans: [] as any[],
    incentives: [] as any[],
    allowances: [] as any[],
    entries: [
      [11, 2026],
      [12, 2026],
      [1, 2027],
      [2, 2027],
    ].map(([month, year]) => ({
      id: `pe-${month}-${year}`,
      month,
      year,
      status: PayrollStatus.PENDING as PayrollStatus,
      totalAllowances: 0,
      netStipend: 0,
      stipendRecord: {
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
      },
    })),
  };
  const withAllowances = (e: any) => ({
    ...e,
    allowances: db.allowances.filter((a) => a.payrollEntryId === e.id),
  });
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    employee: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ status: EmployeeStatus.ACTIVE }),
    },
    incentivePlan: {
      create: jest.fn(async ({ data }) => {
        const plan = {
          id: `plan-${++seq}`,
          stoppedAt: null,
          createdAt: new Date(),
          ...data,
        };
        db.plans.push(plan);
        return plan;
      }),
      findMany: jest.fn(async ({ where }) =>
        db.plans.filter(
          (p) =>
            p.employeeId === where.employeeId &&
            !db.incentives.some(
              (i) =>
                i.planId === p.id &&
                i.month === where.incentives.none.month &&
                i.year === where.incentives.none.year,
            ),
        ),
      ),
      findUnique: jest.fn(
        async ({ where }) => db.plans.find((p) => p.id === where.id) ?? null,
      ),
      update: jest.fn(async ({ where, data }) =>
        Object.assign(
          db.plans.find((p) => p.id === where.id),
          data,
        ),
      ),
    },
    incentive: {
      create: jest.fn(async ({ data }) => {
        if (
          data.planId &&
          db.incentives.some(
            (i) =>
              i.planId === data.planId &&
              i.month === data.month &&
              i.year === data.year,
          )
        )
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row = { id: `inc-${++seq}`, ...data };
        db.incentives.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }) =>
        db.incentives.filter((i) => i.planId === where.planId),
      ),
      findUnique: jest.fn(
        async ({ where }) =>
          db.incentives.find((i) => i.id === where.id) ?? null,
      ),
      delete: jest.fn(async ({ where }) => {
        db.incentives = db.incentives.filter((i) => i.id !== where.id);
      }),
    },
    payrollEntry: {
      findMany: jest.fn(async ({ where }) =>
        db.entries.filter(
          (e) => e.month === where.month && e.year === where.year,
        ),
      ),
      findFirst: jest.fn(async ({ where }) => {
        const e = db.entries.find(
          (x) =>
            x.month === where.month &&
            x.year === where.year &&
            db.allowances.some(
              (a) =>
                a.payrollEntryId === x.id &&
                a.description === where.allowances.some.description,
            ),
        );
        return e ? withAllowances(e) : null;
      }),
      update: jest.fn(async ({ where, data }) => {
        const e = db.entries.find((x) => x.id === where.id)!;
        const delta = data.netStipend.increment ?? -data.netStipend.decrement;
        e.totalAllowances += delta;
        e.netStipend += delta;
        return e;
      }),
    },
    allowance: {
      create: jest.fn(async ({ data }) => {
        db.allowances.push({ id: `al-${++seq}`, ...data });
      }),
      delete: jest.fn(async ({ where }) => {
        db.allowances = db.allowances.filter((a) => a.id !== where.id);
      }),
    },
    notification: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma: any = {
    ...tx,
    incentiveType: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 't1', name: 'On Progress' }),
    },
    $transaction: jest.fn(async (work: (c: unknown) => unknown) => work(tx)),
  };
  const service = new IncentivesService(prisma, {
    assertEmployeeAccess: jest.fn(),
  } as never);
  return { service, tx, db };
}

const base = {
  employeeId: 'e1',
  amount: 2000,
  typeId: 't1',
  month: 11,
  year: 2026,
};

describe('recurring incentives (Point 21)', () => {
  it('one-time keeps the old behaviour: no plan, no planId', async () => {
    const { service, tx, db } = build();
    await service.create(base, 'exec-1');
    expect(tx.incentivePlan.create).not.toHaveBeenCalled();
    expect(db.incentives[0].planId).toBeUndefined();
    expect(db.entries[0].netStipend).toBe(2000);
  });

  it('MONTHS creates a plan ending start + N − 1 and pays the first month', async () => {
    const { service, db } = build();
    await service.create(
      { ...base, duration: IncentiveDuration.MONTHS, months: 3 },
      'exec-1',
    );
    expect(db.plans[0]).toMatchObject({
      startMonth: 11,
      startYear: 2026,
      endMonth: 1,
      endYear: 2027,
    });
    expect(db.incentives).toHaveLength(1);
    expect(db.incentives[0]).toMatchObject({
      planId: db.plans[0].id,
      month: 11,
      year: 2026,
    });
  });

  it('later months are added once (idempotent) and stop after the last month', async () => {
    const { service, tx, db } = build();
    await service.create(
      { ...base, duration: IncentiveDuration.MONTHS, months: 3 },
      'exec-1',
    );
    expect(await materializeIncentivePlans(tx, 'e1', 12, 2026)).toBe(1);
    expect(await materializeIncentivePlans(tx, 'e1', 12, 2026)).toBe(0);
    expect(await materializeIncentivePlans(tx, 'e1', 1, 2027)).toBe(1);
    expect(await materializeIncentivePlans(tx, 'e1', 2, 2027)).toBe(0); // ended
    expect(db.incentives.map((i) => `${i.month}/${i.year}`)).toEqual([
      '11/2026',
      '12/2026',
      '1/2027',
    ]);
    expect(db.entries.find((e) => e.id === 'pe-12-2026')!.netStipend).toBe(
      2000,
    );
  });

  it('skips a month whose payroll is not PENDING or an employee who is not active', async () => {
    const { service, tx, db } = build();
    await service.create(
      { ...base, duration: IncentiveDuration.PERMANENT },
      'exec-1',
    );
    db.entries.find((e) => e.id === 'pe-12-2026')!.status = PayrollStatus.PAID;
    expect(await materializeIncentivePlans(tx, 'e1', 12, 2026)).toBe(0);
    tx.employee.findUnique.mockResolvedValue({
      status: EmployeeStatus.SUSPENDED,
    });
    expect(await materializeIncentivePlans(tx, 'e1', 1, 2027)).toBe(0);
  });

  it('stop sets the last month, removes a later PENDING month and keeps paid ones', async () => {
    const { service, tx, db } = build();
    await service.create(
      { ...base, duration: IncentiveDuration.PERMANENT },
      'exec-1',
    );
    await materializeIncentivePlans(tx, 'e1', 12, 2026);
    await materializeIncentivePlans(tx, 'e1', 1, 2027);
    db.entries.find((e) => e.id === 'pe-1-2027')!.status = PayrollStatus.PAID;
    await materializeIncentivePlans(tx, 'e1', 2, 2027);
    await service.stopPlan(
      db.plans[0].id,
      { lastMonth: 11, lastYear: 2026 },
      'exec-1',
    );

    expect(db.plans[0]).toMatchObject({ endMonth: 11, endYear: 2026 });
    expect(db.plans[0].stoppedAt).toBeInstanceOf(Date);
    // Dec (pending) removed with its payroll row; Jan (paid) stays. Feb was never added (not PENDING).
    expect(db.incentives.map((i) => `${i.month}/${i.year}`)).toEqual([
      '11/2026',
      '1/2027',
    ]);
    expect(db.entries.find((e) => e.id === 'pe-12-2026')!.netStipend).toBe(0);
    expect(await materializeIncentivePlans(tx, 'e1', 3, 2027)).toBe(0);
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'INCENTIVE_PLAN_STOPPED' }),
      }),
    );
  });

  it('changing the amount applies to months added afterwards', async () => {
    const { service, tx, db } = build();
    await service.create(
      { ...base, duration: IncentiveDuration.PERMANENT },
      'exec-1',
    );
    await service.updatePlan(db.plans[0].id, { amount: 3000 }, 'exec-1');
    await materializeIncentivePlans(tx, 'e1', 12, 2026);
    expect(db.incentives.map((i) => Number(i.amount))).toEqual([2000, 3000]);
  });

  it('the payslip line never says how long the incentive repeats', async () => {
    const { service, db } = build();
    await service.create(
      { ...base, duration: IncentiveDuration.MONTHS, months: 3 },
      'exec-1',
    );
    expect(db.allowances[0].description).toBe('Incentive: On Progress');
    expect(db.allowances[0].description).not.toMatch(/month|permanent|plan/i);
  });

  it('planCoversMonth: open end is permanent; end is inclusive', () => {
    const plan = {
      startMonth: 11,
      startYear: 2026,
      endMonth: null,
      endYear: null,
    };
    expect(planCoversMonth(plan, 10, 2026)).toBe(false);
    expect(planCoversMonth(plan, 5, 2030)).toBe(true);
    expect(
      planCoversMonth({ ...plan, endMonth: 1, endYear: 2027 }, 1, 2027),
    ).toBe(true);
    expect(
      planCoversMonth({ ...plan, endMonth: 1, endYear: 2027 }, 2, 2027),
    ).toBe(false);
  });
});
