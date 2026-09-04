import { AttendanceLogType, AttendanceStatus, PayrollStatus } from '@prisma/client';
import { PayrollService } from './payroll.service';

jest.mock('../attendance/discipline.helper', () => ({
  repairLateDisciplineForPayrollMonth: jest.fn().mockResolvedValue({
    applied: 0,
    repaired: 0,
    skipped: 0,
  }),
}));

beforeAll(() => {
  jest.useFakeTimers({
    now: new Date('2026-09-15T07:00:00.000Z'),
    doNotFake: [
      'nextTick',
      'setImmediate',
      'setTimeout',
      'setInterval',
      'clearTimeout',
      'clearInterval',
      'performance',
      'queueMicrotask',
      'hrtime',
    ],
  });
});
afterAll(() => {
  jest.useRealTimers();
});

/**
 * Integration-level regression coverage for Step 3: multi-segment
 * discovery/recompute architecture (createOrGetEntry's expanded
 * stipend-segment discovery, recomputeEmployeeMonth, and the three
 * segment-bounded child-row helpers). Uses a small in-memory fake Prisma
 * double — the orchestration under test touches many models
 * (Employee, StipendRecord, PayrollEntry, AttendanceLog,
 * AdditionalWorkingDay, RelieverSession, PayrollDeduction, Allowance,
 * AuditLog) in a way that can't be exercised meaningfully through
 * payroll.service.spec.ts's single-method mock alone.
 *
 * Root cause being regression-tested: createOrGetEntry only ever
 * discovered the StipendRecord with effectiveTo: null, so once a
 * mid-month salary increment created a second StipendRecord, the old
 * segment's PayrollEntry became permanently unreachable/unrefreshable.
 * Separately, the three sibling child-row helpers
 * (AdditionalWorkingDays/UnpaidLeave/Reliever) queried the WHOLE month
 * regardless of which segment they were computing for, so multi-segment
 * refresh would have duplicated those amounts across segments.
 */

let idCounter = 0;
function newId(prefix: string) {
  idCounter++;
  return `${prefix}-${idCounter}`;
}

type FakeStipendRecord = {
  id: string;
  employeeId: string;
  basicStipend: number;
  allowances: number;
  reward: number;
  progressReward: number;
  fuelAllowance: number;
  loanDeduction: number;
  advanceDeduction: number;
  fineDeduction: number;
  healthDeduction: number;
  lumpsumTotal: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

type FakeAttendanceLog = {
  employeeId: string;
  type: AttendanceLogType;
  date: Date;
  checkIn: Date | null;
  checkOut: Date | null;
  status: AttendanceStatus;
  note: string | null;
  dutyStartTimeSnapshot: string | null;
  dutyEndTimeSnapshot: string | null;
  overtimeMinutes?: number;
};

type FakeDeduction = { id: string; payrollEntryId: string; reason: string; amount: number; description: string | null };
type FakeAllowance = { id: string; payrollEntryId: string; type: string; amount: number; hours: number | null; description: string | null };

type FakePayrollEntry = {
  id: string;
  stipendRecordId: string;
  month: number;
  year: number;
  status: PayrollStatus;
  basicStipend: number;
  totalAllowances: number;
  totalDeductions: number;
  netStipend: number;
  forcedNonActive: boolean;
};

class FakeDb {
  employees = new Map<string, any>();
  stipendRecords = new Map<string, FakeStipendRecord>();
  payrollEntries = new Map<string, FakePayrollEntry>();
  attendanceLogs: FakeAttendanceLog[] = [];
  additionalWorkingDays: Array<{ employeeId: string; date: Date; note: string | null }> = [];
  relieverSessions: Array<{ employeeId: string; date: Date; checkIn: Date; checkOut: Date | null; totalMinutes: number }> = [];
  deductions = new Map<string, FakeDeduction>();
  allowances = new Map<string, FakeAllowance>();
  auditLogs: any[] = [];
}

function inDateRange(date: Date, where: { gte?: Date; lte?: Date; lt?: Date }): boolean {
  if (where.gte && date.getTime() < where.gte.getTime()) return false;
  if (where.lte && date.getTime() > where.lte.getTime()) return false;
  if (where.lt && date.getTime() >= where.lt.getTime()) return false;
  return true;
}

function makeFakePrisma(db: FakeDb) {
  const prisma = {
    employee: {
      findUnique: async ({ where }: any) => db.employees.get(where.id) ?? null,
    },
    stipendRecord: {
      findMany: async ({ where }: any) => {
        const monthEndBound: Date = where.effectiveFrom.lte;
        const orClauses: any[] = where.OR;
        return [...db.stipendRecords.values()]
          .filter((r) => r.employeeId === where.employeeId)
          .filter((r) => r.effectiveFrom.getTime() <= monthEndBound.getTime())
          .filter((r) =>
            orClauses.some((clause) =>
              'effectiveTo' in clause && clause.effectiveTo === null
                ? r.effectiveTo === null
                : r.effectiveTo != null && r.effectiveTo.getTime() > clause.effectiveTo.gt.getTime(),
            ),
          )
          .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
      },
    },
    payrollEntry: {
      findUnique: async ({ where, include }: any) => {
        let entry: FakePayrollEntry | undefined;
        if (where.id) entry = db.payrollEntries.get(where.id);
        else if (where.stipendRecordId_month_year) {
          const { stipendRecordId, month, year } = where.stipendRecordId_month_year;
          entry = [...db.payrollEntries.values()].find(
            (e) => e.stipendRecordId === stipendRecordId && e.month === month && e.year === year,
          );
        }
        if (!entry) return null;
        return hydrate(entry, include);
      },
      create: async ({ data, include }: any) => {
        const entry: FakePayrollEntry = {
          id: newId('pe'),
          stipendRecordId: data.stipendRecordId,
          month: data.month,
          year: data.year,
          status: data.status,
          basicStipend: data.basicStipend,
          totalAllowances: data.totalAllowances,
          totalDeductions: data.totalDeductions,
          netStipend: data.netStipend,
          forcedNonActive: data.forcedNonActive ?? false,
        };
        db.payrollEntries.set(entry.id, entry);
        return hydrate(entry, include);
      },
      update: async ({ where, data, include }: any) => {
        const entry = db.payrollEntries.get(where.id)!;
        Object.assign(entry, data);
        return hydrate(entry, include);
      },
      findMany: async ({ where }: any) =>
        [...db.payrollEntries.values()].filter((e) => {
          if (where.month != null && e.month !== where.month) return false;
          if (where.year != null && e.year !== where.year) return false;
          if (where.status != null && e.status !== where.status) return false;
          if (
            where.stipendRecordId?.in &&
            !where.stipendRecordId.in.includes(e.stipendRecordId)
          ) {
            return false;
          }
          if (where.stipendRecord?.employeeId) {
            const sr = [...db.stipendRecords.values()].find(
              (r) => r.id === e.stipendRecordId,
            );
            if (!sr || sr.employeeId !== where.stipendRecord.employeeId) {
              return false;
            }
          }
          return true;
        }),
      delete: async ({ where }: any) => {
        db.payrollEntries.delete(where.id);
      },
    },
    payrollDeduction: {
      findFirst: async ({ where }: any) =>
        [...db.deductions.values()].find((d) => d.payrollEntryId === where.payrollEntryId && (!where.reason || d.reason === where.reason)) ?? null,
      findMany: async ({ where }: any) =>
        [...db.deductions.values()].filter(
          (d) => d.payrollEntryId === where.payrollEntryId && (!where.reason || d.reason === where.reason),
        ),
      deleteMany: async ({ where }: any) => {
        if (where.payrollEntryId) {
          let count = 0;
          for (const [id, d] of db.deductions) {
            if (d.payrollEntryId === where.payrollEntryId) {
              db.deductions.delete(id);
              count += 1;
            }
          }
          return { count };
        }
        const ids: string[] = where.id?.in ?? [];
        for (const id of ids) db.deductions.delete(id);
        return { count: ids.length };
      },
      create: async ({ data }: any) => {
        const d: FakeDeduction = { id: newId('ded'), ...data };
        db.deductions.set(d.id, d);
        return d;
      },
      update: async ({ where, data }: any) => {
        const d = db.deductions.get(where.id)!;
        Object.assign(d, data);
        return d;
      },
      delete: async ({ where }: any) => {
        const d = db.deductions.get(where.id)!;
        db.deductions.delete(where.id);
        return d;
      },
    },
    allowance: {
      findFirst: async ({ where }: any) =>
        [...db.allowances.values()].find((a) => a.payrollEntryId === where.payrollEntryId && a.type === where.type) ?? null,
      findMany: async ({ where }: any) =>
        [...db.allowances.values()].filter(
          (a) => a.payrollEntryId === where.payrollEntryId && a.type === where.type,
        ),
      deleteMany: async ({ where }: any) => {
        if (where.payrollEntryId) {
          let count = 0;
          for (const [id, a] of db.allowances) {
            if (a.payrollEntryId === where.payrollEntryId) {
              db.allowances.delete(id);
              count += 1;
            }
          }
          return { count };
        }
        const ids: string[] = where.id?.in ?? [];
        for (const id of ids) db.allowances.delete(id);
        return { count: ids.length };
      },
      create: async ({ data }: any) => {
        const a: FakeAllowance = { id: newId('allow'), ...data };
        db.allowances.set(a.id, a);
        return a;
      },
      update: async ({ where, data }: any) => {
        const a = db.allowances.get(where.id)!;
        Object.assign(a, data);
        return a;
      },
      delete: async ({ where }: any) => {
        const a = db.allowances.get(where.id)!;
        db.allowances.delete(where.id);
        return a;
      },
    },
    leaveRecord: {
      findMany: async () => [],
    },
    attendanceLog: {
      findMany: async ({ where }: any) =>
        db.attendanceLogs
          .filter((l) => l.employeeId === where.employeeId)
          .filter((l) => !where.type || l.type === where.type)
          .filter((l) => !where.status || l.status === where.status)
          .filter((l) => inDateRange(l.date, where.date))
          .sort((a, b) => a.date.getTime() - b.date.getTime()),
    },
    additionalWorkingDay: {
      findMany: async ({ where }: any) =>
        db.additionalWorkingDays
          .filter((d) => d.employeeId === where.employeeId)
          .filter((d) => inDateRange(d.date, where.date)),
    },
    relieverSession: {
      findMany: async ({ where }: any) =>
        db.relieverSessions
          .filter((s) => s.employeeId === where.employeeId)
          .filter((s) => inDateRange(s.date, where.date))
          .filter((s) => s.checkOut !== null),
    },
    letter: {
      findMany: async () => [],
    },
    stipendReceipt: {
      deleteMany: async () => ({ count: 0 }),
    },
    auditLog: {
      create: async ({ data }: any) => {
        db.auditLogs.push(data);
        return data;
      },
    },
    $transaction: async (fn: any) => fn(prisma),
  };

  function hydrate(entry: FakePayrollEntry, include: any) {
    if (!include) return { ...entry };
    return {
      ...entry,
      ...(include.deductions ? { deductions: [...db.deductions.values()].filter((d) => d.payrollEntryId === entry.id) } : {}),
      ...(include.allowances ? { allowances: [...db.allowances.values()].filter((a) => a.payrollEntryId === entry.id) } : {}),
    };
  }

  return prisma;
}

function makeService(db: FakeDb) {
  const prisma = makeFakePrisma(db);
  const accessScopeService = { assertEmployeeAccess: jest.fn().mockResolvedValue(undefined) };
  return new PayrollService(prisma as any, accessScopeService as any);
}

function pkTime(day: number, hours: number, minutes = 0): Date {
  return new Date(Date.UTC(2026, 7, day, hours - 5, minutes, 0));
}
function augustDate(day: number): Date {
  return new Date(Date.UTC(2026, 7, day, 0, 0, 0));
}
function augDate2(monthIndex0: number, day: number): Date {
  return new Date(Date.UTC(2026, monthIndex0, day, 0, 0, 0));
}

const EMP_ID = 'emp-1';
const FULL_DAY_MINUTES = 480;

function seedEmployee(db: FakeDb, overrides: Partial<any> = {}) {
  db.employees.set(EMP_ID, {
    id: EMP_ID,
    status: 'ACTIVE',
    dutyTotalHours: null,
    dutyStartTime: null,
    dutyEndTime: null,
    monthlyAllowedLeaves: null,
    relieverOnly: false,
    shift: null,
    ...overrides,
  });
}

function seedStipend(db: FakeDb, basicStipend: number, effectiveFrom: Date, effectiveTo: Date | null): FakeStipendRecord {
  const r: FakeStipendRecord = {
    id: newId('sr'),
    employeeId: EMP_ID,
    basicStipend,
    allowances: 0,
    reward: 0,
    progressReward: 0,
    fuelAllowance: 0,
    loanDeduction: 0,
    advanceDeduction: 0,
    fineDeduction: 0,
    healthDeduction: 0,
    lumpsumTotal: basicStipend,
    effectiveFrom,
    effectiveTo,
  };
  db.stipendRecords.set(r.id, r);
  return r;
}

function seedFullMonthPresent(db: FakeDb, days: number[] = Array.from({ length: 31 }, (_, i) => i + 1)) {
  for (const day of days) {
    db.attendanceLogs.push({
      employeeId: EMP_ID,
      type: AttendanceLogType.REGULAR,
      date: augustDate(day),
      checkIn: pkTime(day, 9, 0),
      checkOut: pkTime(day, 17, 0),
      status: AttendanceStatus.PRESENT,
      note: null,
      dutyStartTimeSnapshot: null,
      dutyEndTimeSnapshot: null,
    });
  }
}

const AUG_15 = new Date(Date.UTC(2026, 7, 15, 0, 0, 0));

describe('PayrollService — Step 3 multi-segment discovery/recompute architecture', () => {
  // A. Single stipend record / full month => behavior unchanged.
  it('A: a single full-month stipend record behaves exactly as before segmentation existed', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    const entry = await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    expect(entry.status).toBe(PayrollStatus.PENDING);
    expect(entry.basicStipend).toBe(24800);
    expect(db.payrollEntries.size).toBe(1);
  });

  // B. Two stipend segments: both contractual periods kept.
  it('B: createOrGetEntry keeps closed + active rows for mid-month stipend change', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    const primary = await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    expect(db.payrollEntries.size).toBe(2);
    expect(primary.stipendRecordId).toBe(newSr.id);
    const oldEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id)!;
    const newEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    // 2026-09-04 rewrite: a mid-month PACKAGE CHANGE (not join/leave) uses
    // the NEW package's Basic for the whole month, no blending — the
    // closed OLD segment earns 0 (applyPackageDeductions=false), see
    // payroll_rulebook.md "Mid-month package/salary change".
    expect(oldEntry.basicStipend).toBe(0);
    expect(newEntry.basicStipend).toBe(27900);
  });

  it('C: a later createOrGetEntry does not duplicate segment rows', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    expect(db.payrollEntries.size).toBe(2);
    expect(
      [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id),
    ).toBeDefined();
  });

  it('D: three overlapping segments produce a payroll row per contractual period', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const AUG_10 = new Date(Date.UTC(2026, 7, 10));
    const AUG_21 = new Date(Date.UTC(2026, 7, 21));
    seedStipend(db, 20000, new Date(Date.UTC(2000, 0, 1)), AUG_10);
    seedStipend(db, 24000, AUG_10, AUG_21);
    const sr3 = seedStipend(db, 28000, AUG_21, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    expect(db.payrollEntries.size).toBe(3);
    const e3 = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === sr3.id)!;
    expect(e3.basicStipend).toBeGreaterThan(0);
  });

  // E. No duplicate PayrollEntry rows are created.
  it('E: calling createOrGetEntry repeatedly never creates a duplicate row for the same segment', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    await service.recomputeEmployeeMonth({ employeeId: EMP_ID, month: 8, year: 2026 });
    expect(db.payrollEntries.size).toBe(2);
  });

  // F. Mid-month stipend change keeps both contractual periods.
  it('F: generate keeps closed + active PENDING rows for mid-month stipend change', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    expect(db.payrollEntries.size).toBe(2);
    const newEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    expect(newEntry.status).toBe(PayrollStatus.PENDING);
  });

  it('G: a PAID active row is not deleted by a later refresh', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const activeEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    activeEntry.status = PayrollStatus.PAID;
    const frozenSnapshot = { ...activeEntry };

    await service.recomputeEmployeeMonth({ employeeId: EMP_ID, month: 8, year: 2026 });
    const after = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    expect(after).toEqual(frozenSnapshot);
  });

  it('H: an AdditionalWorkingDay row is credited on the active payroll row', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    db.additionalWorkingDays.push({ employeeId: EMP_ID, date: augustDate(20), note: null });
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const newAllowances = [...db.allowances.values()].filter(
      (a) => a.payrollEntryId === [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!.id,
    );
    expect(newAllowances.find((a) => a.type === 'ADDITIONAL_WORKING_DAYS')).toBeDefined();
  });

  it('I: unpaid-leave days beyond quota reduce Basic via payableDays, with no separate UNPAID_LEAVE deduction row', async () => {
    // 2026-09-04 rewrite: unpaid leave beyond the monthly quota is handled
    // ENTIRELY by excluding that day from payableDays (Basic loses its
    // share automatically) — the old separate UNPAID_LEAVE PayrollDeduction
    // row is removed so the same day is never double-charged. See
    // payroll_rulebook.md "Unpaid leave beyond quota".
    const db = new FakeDb();
    seedEmployee(db, { monthlyAllowedLeaves: 2 });
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedFullMonthPresent(db);
    // Days 1-2 are within the 2-day monthly quota (paid); day 3 is a 3rd
    // ON_LEAVE day beyond quota (unpaid).
    for (const day of [1, 2, 3]) {
      const log = db.attendanceLogs.find((l) => l.date.getTime() === augustDate(day).getTime())!;
      log.status = AttendanceStatus.ON_LEAVE;
      log.checkIn = null;
      log.checkOut = null;
    }
    const service = makeService(db);

    const entry = await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const deductions = [...db.deductions.values()].filter((d) => d.payrollEntryId === entry.id);
    expect(deductions.find((d) => d.reason === 'UNPAID_LEAVE')).toBeUndefined();
    // 30 payable days / 31 (1 unpaid day excluded) * 24800
    expect(entry.basicStipend).toBeCloseTo((24800 * 30) / 31, 2);
  });

  it('J: a RelieverSession in the active window is credited once on that row', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    db.relieverSessions.push({
      employeeId: EMP_ID, date: augustDate(20),
      checkIn: pkTime(20, 18, 0), checkOut: pkTime(20, 22, 0), totalMinutes: 240,
    });
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const newEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    const newReliever = [...db.allowances.values()].find((a) => a.payrollEntryId === newEntry.id && a.type === 'RELIEVER');
    expect(newReliever).toBeDefined();
    // Final policy: partial reliever = actual approved hours, not a forced full day.
    expect(newReliever!.hours).toBe(4);
  });

  it('L: month payroll combines contractual segments (old + new)', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const total = [...db.payrollEntries.values()].reduce((sum, e) => sum + e.basicStipend, 0);
    expect(db.payrollEntries.size).toBe(2);
    // 2026-09-04 rewrite: a mid-month PACKAGE CHANGE uses the NEW package's
    // Basic for the whole month, no blending — closed OLD segment earns 0.
    expect(total).toBe(27900);
  });

  // M. PRESENT floor still works; Basic is contractual full month.
  it('M: PRESENT/SWAP_COVERED still earn a full-day floor; Basic remains contractual full month', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    db.attendanceLogs.push({
      employeeId: EMP_ID, type: AttendanceLogType.REGULAR, date: augustDate(1),
      checkIn: pkTime(1, 9, 0), checkOut: pkTime(1, 9, 5), // short/anomalous-shaped session
      status: AttendanceStatus.PRESENT, note: null, dutyStartTimeSnapshot: null, dutyEndTimeSnapshot: null,
    });
    const service = makeService(db);

    const entry = await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    expect(entry.basicStipend).toBe(24800);
    expect(entry.netStipend).toBe(24800);
  });

  // N. half-open boundary; both segments retained.
  it('N: the transition date is attributed to the new segment; both segments are kept', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    for (const day of [14, 15]) {
      db.attendanceLogs.push({
        employeeId: EMP_ID, type: AttendanceLogType.REGULAR, date: augustDate(day),
        checkIn: pkTime(day, 9, 0), checkOut: pkTime(day, 17, 0),
        status: AttendanceStatus.PRESENT, note: null, dutyStartTimeSnapshot: null, dutyEndTimeSnapshot: null,
      });
    }
    const service = makeService(db);
    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const oldEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id)!;
    const newEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    // 2026-09-04 rule: mid-month PACKAGE CHANGE — the closed OLD segment
    // earns 0 (no blending), and the active NEW segment is widened to the
    // whole month (backfillFromJoining), earning the full contractual
    // amount: Aug 14 and 15 are logged PRESENT, and the remaining 29
    // elapsed August days gap-fill (no log, but within employment) —
    // 31/31 payable days, capped at the full 27900.
    expect(oldEntry.basicStipend).toBe(0);
    expect(newEntry.basicStipend).toBe(27900);
  });

  // O. monthly summary unique employee count still correct.
  it('O: getMonthlyPayrollSummary counts this employee once, not twice, despite two segment rows', async () => {
    const db = new FakeDb();
    seedEmployee(db, { fullName: 'Test Employee', employeeCode: 'E-1', currentBranchId: 'b-1' });
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);
    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);

    const entries = [...db.payrollEntries.values()];
    expect(entries.length).toBe(2);
    const distinctEmployeeIds = new Set(
      entries.map((e) => db.stipendRecords.get(e.stipendRecordId)!.employeeId),
    );
    expect(distinctEmployeeIds.size).toBe(1);
  });

  // recomputeEmployeeMonth: does not create new entries, reports missing segments.
  it('recomputeEmployeeMonth never creates a new PayrollEntry and reports segments with no existing entry', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    const results = await service.recomputeEmployeeMonth({ employeeId: EMP_ID, month: 8, year: 2026 });
    expect(db.payrollEntries.size).toBe(0); // nothing created
    expect(results.every((r) => r.status === 'NO_EXISTING_ENTRY')).toBe(true);
    expect(results).toHaveLength(2);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const resultsAfter = await service.recomputeEmployeeMonth({ employeeId: EMP_ID, month: 8, year: 2026 });
    expect(resultsAfter.filter((r) => r.status === 'RECOMPUTED')).toHaveLength(2);
    expect(db.payrollEntries.size).toBe(2);
  });
});
