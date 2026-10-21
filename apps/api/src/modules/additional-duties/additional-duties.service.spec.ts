import {
  AdditionalDutiesService,
  cleanTitle,
  dutyActiveInMonth,
  dutyNeedsAllowance,
} from './additional-duties.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('dutyActiveInMonth', () => {
  it('counts a duty touching any day of the month', () => {
    expect(
      dutyActiveInMonth(
        { startDate: d('2026-11-30'), endDate: null },
        2026,
        11,
      ),
    ).toBe(true);
    expect(
      dutyActiveInMonth(
        { startDate: d('2026-09-01'), endDate: d('2026-11-01') },
        2026,
        11,
      ),
    ).toBe(true);
    expect(
      dutyActiveInMonth(
        { startDate: d('2026-09-01'), endDate: null },
        2026,
        11,
      ),
    ).toBe(true);
  });

  it('skips duties starting after or ending before the month', () => {
    expect(
      dutyActiveInMonth(
        { startDate: d('2026-12-01'), endDate: null },
        2026,
        11,
      ),
    ).toBe(false);
    expect(
      dutyActiveInMonth(
        { startDate: d('2026-09-01'), endDate: d('2026-10-31') },
        2026,
        11,
      ),
    ).toBe(false);
  });
});

describe('dutyNeedsAllowance', () => {
  const duty = {
    startDate: d('2026-10-05'),
    endDate: null,
    allowanceId: 'a1' as string | null,
  };

  it('flags no allowance, a missing linked row, or one not paying the month', () => {
    expect(
      dutyNeedsAllowance({ ...duty, allowanceId: null }, undefined, 2026, 11),
    ).toBe(true);
    expect(dutyNeedsAllowance(duty, undefined, 2026, 11)).toBe(true);
    expect(
      dutyNeedsAllowance(
        duty,
        { startMonth: d('2026-10-01'), endMonth: d('2026-10-01') },
        2026,
        11,
      ),
    ).toBe(true);
    expect(
      dutyNeedsAllowance(
        duty,
        { startMonth: d('2026-12-01'), endMonth: null },
        2026,
        11,
      ),
    ).toBe(true);
  });

  it('passes when the linked allowance covers the month', () => {
    expect(
      dutyNeedsAllowance(
        duty,
        { startMonth: d('2026-10-01'), endMonth: null },
        2026,
        11,
      ),
    ).toBe(false);
  });

  it('ignores duties not held that month', () => {
    expect(
      dutyNeedsAllowance({ ...duty, allowanceId: null }, undefined, 2026, 9),
    ).toBe(false);
  });
});

describe('cleanTitle', () => {
  it('trims and rejects empty / too long', () => {
    expect(cleanTitle('  Ward In-charge ')).toBe('Ward In-charge');
    expect(() => cleanTitle('   ')).toThrow('Write the duty title');
    expect(() => cleanTitle('x'.repeat(101))).toThrow('too long');
  });
});

describe('AdditionalDutiesService', () => {
  function build(duty: Record<string, unknown> | null = null) {
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 'e1' }) },
      employeeAdditionalDuty: {
        create: jest.fn(async ({ data }) => ({ id: 'd1', ...data })),
        update: jest.fn(async ({ data }) => ({ id: 'd1', ...data })),
        findUnique: jest.fn().mockResolvedValue(duty),
        findMany: jest.fn(),
      },
      employeeAllowance: { findUnique: jest.fn(), findMany: jest.fn() },
      additionalDutyMonthCheck: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([{ employeeId: 'acc' }]) },
      notification: { create: jest.fn() },
    };
    return { prisma, service: new AdditionalDutiesService(prisma as never) };
  }
  const user = { id: 'u1' };

  it('rejects an end date before the start date', async () => {
    const { service, prisma } = build();
    await expect(
      service.create(
        {
          employeeId: 'e1',
          title: 'Ward In-charge',
          startDate: '2026-10-10',
          endDate: '2026-10-01',
        },
        user,
      ),
    ).rejects.toThrow('End date cannot be before');
    expect(prisma.employeeAdditionalDuty.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown employee', async () => {
    const { service, prisma } = build();
    prisma.employee.findUnique.mockResolvedValue(null);
    await expect(
      service.create(
        { employeeId: 'x', title: 'Ward In-charge', startDate: '2026-10-10' },
        user,
      ),
    ).rejects.toThrow('Employee not found');
  });

  it('creates with a trimmed title and writes an audit row', async () => {
    const { service, prisma } = build();
    const duty = await service.create(
      { employeeId: 'e1', title: ' Ward In-charge ', startDate: '2026-10-10' },
      user,
    );
    expect(duty.title).toBe('Ward In-charge');
    expect(duty.endDate).toBeNull();
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe(
      'ADDITIONAL_DUTY_CREATED',
    );
  });

  it('checks an update against the stored start date', async () => {
    const { service } = build({
      id: 'd1',
      employeeId: 'e1',
      startDate: d('2026-10-10'),
      endDate: null,
    });
    await expect(
      service.update('d1', { endDate: '2026-10-01' }, user),
    ).rejects.toThrow('End date cannot be before');
  });

  it("refuses to link another employee's allowance", async () => {
    const { service, prisma } = build({
      id: 'd1',
      employeeId: 'e1',
      allowanceId: null,
    });
    prisma.employeeAllowance.findUnique.mockResolvedValue({ employeeId: 'e2' });
    await expect(service.linkAllowance('d1', 'a1', user)).rejects.toThrow(
      'not on this employee',
    );
  });

  it('a duty Accounts closed for the month with a reason is not listed again', async () => {
    const { service, prisma } = build();
    prisma.employeeAdditionalDuty.findMany.mockResolvedValue([
      {
        id: 'd9',
        title: 'Incharge',
        startDate: new Date('2026-10-01T00:00:00Z'),
        endDate: null,
        allowanceId: null,
        employee: { id: 'e1', fullName: 'A' },
      },
    ]);
    prisma.additionalDutyMonthCheck.findMany.mockResolvedValue([{ dutyId: 'd9' }]);
    await expect(service.missingAllowance(2026, 10)).resolves.toEqual([]);
  });

  it('missingAllowance lists only duties the month does not pay', async () => {
    const { service, prisma } = build();
    const employee = { id: 'e1', fullName: 'A' };
    prisma.employeeAdditionalDuty.findMany.mockResolvedValue([
      {
        id: 'none',
        allowanceId: null,
        startDate: d('2026-10-01'),
        endDate: null,
        employee,
      },
      {
        id: 'paid',
        allowanceId: 'a1',
        startDate: d('2026-10-01'),
        endDate: null,
        employee,
      },
      {
        id: 'lapsed',
        allowanceId: 'a2',
        startDate: d('2026-10-01'),
        endDate: null,
        employee,
      },
    ]);
    prisma.employeeAllowance.findMany.mockResolvedValue([
      { id: 'a1', startMonth: d('2026-10-01'), endMonth: null },
      { id: 'a2', startMonth: d('2026-10-01'), endMonth: d('2026-10-01') },
    ]);
    const rows = await service.missingAllowance(2026, 11);
    expect(rows.map((r) => r.id)).toEqual(['none', 'lapsed']);
    const where = prisma.employeeAdditionalDuty.findMany.mock.calls[0][0].where;
    expect(where.startDate.lte).toEqual(d('2026-11-30'));
    expect(where.OR[1].endDate.gte).toEqual(d('2026-11-01'));
  });
});

describe('Req 5: ending a role ends its allowance', () => {
  it('ends the linked allowance on the role end day', async () => {
    const duty = {
      id: 'd1',
      employeeId: 'e1',
      title: 'Admin',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: null,
      allowanceId: 'a1',
      note: null,
    };
    const prisma = {
      employeeAdditionalDuty: {
        findUnique: jest.fn().mockResolvedValue(duty),
        update: jest.fn(async ({ data }) => ({ ...duty, ...data })),
      },
      auditLog: { create: jest.fn() },
    };
    const allowances = { end: jest.fn() };
    const service = new AdditionalDutiesService(prisma as never, allowances as never);
    await service.update('d1', { endDate: '2026-11-20' }, { id: 'hr' });
    expect(allowances.end).toHaveBeenCalledWith('a1', '2026-11', { id: 'hr' }, 20);
  });
});
