import { PayrollService } from './payroll.service';
import { loadAttendanceCard } from '../attendance/attendance-card.util';

jest.mock('../attendance/attendance-card.util', () => ({ loadAttendanceCard: jest.fn() }));
jest.mock('../attendance/discipline.helper', () => ({ repairLateDisciplineForPayrollMonth: jest.fn() }));

const dto = { employeeId: 'employee', month: 8, year: 2026 };
const record = { id: 'package', employeeId: dto.employeeId, basicStipend: 31000, effectiveFrom: new Date('2026-08-01'), effectiveTo: null };
const card = { calendarDays: 31, present: 27, absent: 1, uninformedAbsent: 0, late: 3, halfDay: 0, shortLeave: 0, onLeave: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, holiday: 0, swapCovered: 0, unmarked: 0, additionalWorkingDays: 1, overtimeHours: 8, missingDates: [], days: [], paidLeaveDateKeys: [], risks: [] };

// Transaction contract double, not PostgreSQL integration coverage. Each transaction
// owns a copy and publishes it only on success; concurrent transactions queue.
function fixture(initialEntry = true, frozenAmount?: number) {
  let state: any = {
    entries: initialEntry ? [{ id: 'entry', stipendRecordId: 'package', month: 8, year: 2026, status: 'PENDING', basicStipend: 31000, totalDeductions: 2100, totalAllowances: 9999, netStipend: 38899 }] : [],
    deductions: initialEntry ? [{ id: 'legacy', payrollEntryId: 'entry', reason: 'UNINFORMED_ABSENCE', description: 'Absent without approved leave (2 days stipend)', amount: 2000 }, { id: 'manual', payrollEntryId: 'entry', reason: 'DISCIPLINARY_FINE', description: 'Inquiry fine — case', amount: 100 }] : [],
    allowances: initialEntry ? [{ id: 'legacy-ot', payrollEntryId: 'entry', type: 'OVERTIME', amount: 9999 }] : [],
  };
  if (frozenAmount !== undefined) state.entries.push({ id: 'frozen', stipendRecordId: 'closed', month: 8, year: 2026, status: 'PAID', basicStipend: frozenAmount, totalDeductions: 0, totalAllowances: 0, netStipend: frozenAmount });
  let failTotals = false;
  let tail = Promise.resolve();
  let sequence = 0;
  const events: string[] = [];
  const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (key === 'stipendRecord') return true;
    if (key === 'OR') return value.some((part: any) => matches(row, part));
    if (key === 'stipendRecordId_month_year') return matches(row, value);
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      if ('gt' in value) return Number(row[key]) > value.gt;
    }
    return row[key] === value;
  });
  const delegates = (get: () => any) => {
    const view = (row: any) => row ? { ...row, deductions: get().deductions.filter((d: any) => d.payrollEntryId === row.id), allowances: get().allowances.filter((a: any) => a.payrollEntryId === row.id) } : null;
    return {
      $queryRaw: jest.fn(async () => { events.push('lock'); return [{ id: dto.employeeId }]; }),
      employee: { findUnique: async () => ({ id: dto.employeeId, status: 'ACTIVE', fullName: 'Test Employee', employeeCode: 'TEST', dutyTotalHours: 8 }) },
      payrollEntry: {
        findUnique: async ({ where }: any) => view(get().entries.find((row: any) => matches(row, where))),
        findUniqueOrThrow: async ({ where }: any) => view(get().entries.find((row: any) => matches(row, where))),
        findFirst: async ({ where }: any) => view(get().entries.find((row: any) => matches(row, where))),
        findMany: async ({ where }: any) => get().entries.filter((row: any) => matches(row, where)).map(view),
        create: async ({ data }: any) => { const row = { id: `entry-${++sequence}`, ...data }; get().entries.push(row); events.push('entry-create'); return view(row); },
        update: async ({ where, data }: any) => { events.push('totals-update'); if (failTotals) throw new Error('injected totals failure'); const row = get().entries.find((e: any) => e.id === where.id); Object.assign(row, data); return view(row); },
      },
      ...Object.fromEntries([['payrollDeduction', 'deductions'], ['allowance', 'allowances']].map(([delegate, collection]) => [delegate, {
        deleteMany: async ({ where }: any) => { events.push(`${collection}-delete`); get()[collection] = get()[collection].filter((row: any) => !matches(row, where)); },
        create: async ({ data }: any) => { events.push(`${collection}-create`); const row = { id: `child-${++sequence}`, ...data }; get()[collection].push(row); return row; },
      }])),
    };
  };
  const prisma: any = {
    ...delegates(() => state),
    $transaction: jest.fn(async (work: any, options: any) => {
      expect(options.isolationLevel).toBe('Serializable');
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const draft = structuredClone(state);
      try { const result = await work(delegates(() => draft)); state = draft; return result; }
      finally { release(); }
    }),
  };
  return { service: new PayrollService(prisma, {} as any), prisma, events, snapshot: () => structuredClone(state), fail: () => { failTotals = true; } };
}

describe('Card salary public API transaction contract (in-memory database)', () => {
  beforeEach(() => {
    jest.mocked(loadAttendanceCard).mockResolvedValue(card as any);
    // Only unrelated discovery/leave/pruning I/O is stubbed. Public entry points,
    // transaction boundary, Card calculation and financial writes stay real.
    jest.spyOn(PayrollService.prototype as any, 'resolveStipendRecordsForPayrollMonth').mockResolvedValue({ records: [record], backfillFromAttendance: false });
    jest.spyOn(PayrollService.prototype as any, 'computeMonthlyUnpaidLeaveDates').mockResolvedValue([]);
    jest.spyOn(PayrollService.prototype as any, 'pruneDuplicateOpenActivePayrollEntries').mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['createOrGetEntry', 'recomputeEmployeeMonth'] as const)('%s rolls back children and totals after the last child write fails', async method => {
    const f = fixture(); const before = f.snapshot(); f.fail();
    await expect(f.service[method](dto)).rejects.toThrow('injected totals failure');
    expect(f.events).toEqual(expect.arrayContaining(['deductions-delete', 'allowances-delete', 'deductions-create', 'allowances-create', 'totals-update']));
    expect(f.snapshot()).toEqual(before);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('concurrent create requests then concurrent refreshes keep one aggregate per charge', async () => {
    const f = fixture(false);
    await Promise.all(Array.from({ length: 5 }, () => f.service.createOrGetEntry(dto)));
    await Promise.all(Array.from({ length: 5 }, (_, i) => i % 2 ? f.service.createOrGetEntry(dto) : f.service.recomputeEmployeeMonth(dto)));
    const final = f.snapshot();
    expect(final.entries).toHaveLength(1);
    expect(final.entries[0].netStipend).toBe(30000);
    expect(final.deductions).toHaveLength(2);
    expect(final.allowances).toHaveLength(2);
    expect(new Set(final.deductions.map((d: any) => d.reason)).size).toBe(2);
    expect(new Set(final.allowances.map((a: any) => a.type)).size).toBe(2);
    expect(f.events.filter(event => event === 'lock')).toHaveLength(10);
  });

  it('repeated refresh preserves manual money exactly once', async () => {
    const f = fixture(); await f.service.createOrGetEntry(dto); await f.service.recomputeEmployeeMonth(dto);
    const final = f.snapshot();
    expect(final.entries[0].netStipend).toBe(29900);
    expect(final.deductions).toHaveLength(3);
    expect(final.deductions.filter((d: any) => d.id === 'manual')).toHaveLength(1);
    expect(final.allowances).toHaveLength(2);
  });

  it('allows a frozen zero sibling and preserves it', async () => {
    const f = fixture(true, 0); const frozen = f.snapshot().entries[1];
    await f.service.createOrGetEntry(dto);
    expect(f.snapshot().entries[0].netStipend).toBe(29900);
    expect(f.snapshot().entries[1]).toEqual(frozen);
  });

  it('rejects a frozen money-bearing sibling before writing children', async () => {
    const f = fixture(true, 1); const before = f.snapshot();
    await expect(f.service.createOrGetEntry(dto)).rejects.toThrow('FROZEN_PAYROLL_SEGMENT');
    expect(f.snapshot()).toEqual(before);
    expect(f.events).toEqual(['lock']);
  });
});

// These guards exercise the real wrapper; the query itself remains a double.
describe('Payroll transaction retry and lock guards', () => {
  it.each(['P2034', 'P2002'])('retries %s and locks before the body on each attempt', async code => {
    const { withPayrollEmployeeTransaction } = await import('./payroll-write-lock.util');
    const events: string[] = [];
    let attempts = 0;
    const tx = { $queryRaw: jest.fn(async () => { events.push('lock'); return []; }) };
    const prisma: any = { $transaction: jest.fn(async (work: any, options: any) => {
      expect(options).toEqual(expect.objectContaining({ isolationLevel: 'Serializable', timeout: 120000, maxWait: 20000 }));
      return work(tx);
    }) };
    await expect(withPayrollEmployeeTransaction(prisma, 'employee', async () => {
      events.push('body'); if (++attempts < 3) throw Object.assign(new Error('retry'), { code }); return 'ok';
    })).resolves.toBe('ok');
    expect(events).toEqual(['lock', 'body', 'lock', 'body', 'lock', 'body']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    const query = tx.$queryRaw.mock.calls[0] as any[];
    expect(query[0].join('?')).toMatch(/Employee.*FOR UPDATE/);
    expect(query[1]).toBe('employee');
  });

  it.each(['P2034', 'P2002'])('limits repeated %s conflicts to four attempts', async code => {
    const { withPayrollEmployeeTransaction } = await import('./payroll-write-lock.util');
    const error = Object.assign(new Error('persistent conflict'), { code });
    const prisma: any = { $transaction: jest.fn(async (work: any) => work({ $queryRaw: async () => [] })) };
    const work = jest.fn(async () => { throw error; });
    await expect(withPayrollEmployeeTransaction(prisma, 'employee', work)).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(4);
  });

  it('propagates a non-retry error after one transaction attempt', async () => {
    const { withPayrollEmployeeTransaction } = await import('./payroll-write-lock.util');
    const error = new Error('financial write failed');
    const prisma: any = { $transaction: jest.fn(async (work: any) => work({ $queryRaw: async () => [] })) };
    await expect(withPayrollEmployeeTransaction(prisma, 'employee', async () => { throw error; })).rejects.toBe(error);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

it('locks multiple employees once each in deterministic order before work', async () => {
  const { withPayrollEmployeeTransaction } = await import('./payroll-write-lock.util');
  const events: string[] = [];
  const tx = { $queryRaw: async (_query: TemplateStringsArray, employeeId: string) => { events.push(employeeId); return []; } };
  const prisma: any = { $transaction: async (work: any) => work(tx) };
  await withPayrollEmployeeTransaction(prisma, ['z', 'a', 'z'], async () => { events.push('work'); });
  expect(events).toEqual(['a', 'z', 'work']);
});
