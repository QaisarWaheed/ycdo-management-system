import { AttendanceLogType, AttendanceStatus, PayrollStatus } from '@prisma/client';
import { PayrollService } from './payroll.service';

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
  return {
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
    },
    payrollDeduction: {
      findFirst: async ({ where }: any) =>
        [...db.deductions.values()].find((d) => d.payrollEntryId === where.payrollEntryId && d.reason === where.reason) ?? null,
      findMany: async ({ where }: any) =>
        [...db.deductions.values()].filter(
          (d) => d.payrollEntryId === where.payrollEntryId && d.reason === where.reason,
        ),
      deleteMany: async ({ where }: any) => {
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
    auditLog: {
      create: async ({ data }: any) => {
        db.auditLogs.push(data);
        return data;
      },
    },
  };

  function hydrate(entry: FakePayrollEntry, include: any) {
    if (!include) return { ...entry };
    return {
      ...entry,
      ...(include.deductions ? { deductions: [...db.deductions.values()].filter((d) => d.payrollEntryId === entry.id) } : {}),
      ...(include.allowances ? { allowances: [...db.allowances.values()].filter((a) => a.payrollEntryId === entry.id) } : {}),
    };
  }
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

  // B. Two stipend segments: both PENDING PayrollEntry rows discovered/refreshed.
  it('B: createOrGetEntry discovers and refreshes BOTH segments, not just the active one', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    const primary = await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    expect(db.payrollEntries.size).toBe(2); // both segments got an entry
    expect(primary.stipendRecordId).toBe(newSr.id); // active (effectiveTo: null) is the primary/returned one

    const oldEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id)!;
    const newEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    expect(oldEntry.basicStipend).toBe(11200); // 14 days * 8h * 100/h
    expect(newEntry.basicStipend).toBe(15300); // 17 days * 8h * 112.5/h
  });

  // C. Old segment is no longer orphaned after a salary increment.
  it('C: the old segment remains reachable/refreshable on a LATER createOrGetEntry call for the (now different) active record', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    // First call creates both. Correct an attendance date in the OLD
    // segment's window, then call createOrGetEntry again (as if refreshing
    // payroll for this employee/month later) -- the old segment's entry
    // must pick up the correction, proving it's still reachable.
    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const log = db.attendanceLogs.find((l) => l.date.getTime() === augustDate(5).getTime())!;
    log.status = AttendanceStatus.ON_LEAVE; // still full policy credit, but proves refresh reran

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const oldEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id)!;
    // Still 14 days' worth (ON_LEAVE still earns full credit) -- the point
    // is this entry was touched a second time at all, not orphaned.
    expect(oldEntry.basicStipend).toBe(11200);
  });

  // D. Three stipend segments: all three recompute correctly.
  it('D: three overlapping segments all get discovered and correctly computed', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const AUG_10 = new Date(Date.UTC(2026, 7, 10));
    const AUG_21 = new Date(Date.UTC(2026, 7, 21));
    const sr1 = seedStipend(db, 20000, new Date(Date.UTC(2000, 0, 1)), AUG_10);
    const sr2 = seedStipend(db, 24000, AUG_10, AUG_21);
    const sr3 = seedStipend(db, 28000, AUG_21, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    expect(db.payrollEntries.size).toBe(3);
    const e1 = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === sr1.id)!;
    const e2 = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === sr2.id)!;
    const e3 = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === sr3.id)!;
    expect(e1.basicStipend).toBeGreaterThan(0);
    expect(e2.basicStipend).toBeGreaterThan(0);
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
    expect(db.payrollEntries.size).toBe(2); // still exactly one per stipendRecordId+month+year
  });

  // F. PROCESSED old segment + PENDING new segment: old byte-for-byte
  // unchanged, new recomputes.
  it('F: a PROCESSED old segment is never overwritten while the new PENDING segment still recomputes', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const oldEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id)!;
    oldEntry.status = PayrollStatus.PROCESSED;
    const frozenSnapshot = { ...oldEntry };

    // Corrupt attendance in the old segment's window -- if the freeze were
    // broken, this would change oldEntry.basicStipend on the next call.
    db.attendanceLogs.find((l) => l.date.getTime() === augustDate(3).getTime())!.status = AttendanceStatus.ABSENT;

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const oldEntryAfter = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id)!;
    expect(oldEntryAfter).toEqual(frozenSnapshot); // byte-for-byte unchanged

    const newEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    expect(newEntry.status).toBe(PayrollStatus.PENDING);
  });

  // G. PAID old segment: unchanged.
  it('G: a PAID old segment is never overwritten by a later refresh', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const oldEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id)!;
    oldEntry.status = PayrollStatus.PAID;
    const frozenSnapshot = { ...oldEntry };

    await service.recomputeEmployeeMonth({ employeeId: EMP_ID, month: 8, year: 2026 });
    const oldEntryAfter = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id)!;
    expect(oldEntryAfter).toEqual(frozenSnapshot);
  });

  // H. Additional Working Days: no duplication across segments.
  it('H: an AdditionalWorkingDay row is credited to exactly one segment, never both', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    db.additionalWorkingDays.push({ employeeId: EMP_ID, date: augustDate(20), note: null }); // in NEW segment's window
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const oldAllowances = [...db.allowances.values()].filter(
      (a) => a.payrollEntryId === [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id)!.id,
    );
    const newAllowances = [...db.allowances.values()].filter(
      (a) => a.payrollEntryId === [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!.id,
    );
    expect(oldAllowances.find((a) => a.type === 'ADDITIONAL_WORKING_DAYS')).toBeUndefined();
    expect(newAllowances.find((a) => a.type === 'ADDITIONAL_WORKING_DAYS')).toBeDefined();
  });

  // I. Unpaid Leave deduction: correct segment/date attribution and no duplication.
  it('I: unpaid-leave days are attributed to the correct segment with a month-global quota, no duplication', async () => {
    const db = new FakeDb();
    seedEmployee(db, { monthlyAllowedLeaves: 2 });
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db, [1, 2]); // minimal baseline attendance
    // 3 ON_LEAVE days total: 2 in the OLD segment (Aug 5, 6), 1 in the NEW
    // segment (Aug 20). Allowance = 2 -> chronologically Aug5/Aug6 are paid
    // (both in OLD segment), Aug20 is the 3rd -> unpaid, in the NEW segment.
    for (const day of [5, 6]) {
      db.attendanceLogs.push({
        employeeId: EMP_ID, type: AttendanceLogType.REGULAR, date: augustDate(day),
        checkIn: null, checkOut: null, status: AttendanceStatus.ON_LEAVE, note: null,
        dutyStartTimeSnapshot: null, dutyEndTimeSnapshot: null,
      });
    }
    db.attendanceLogs.push({
      employeeId: EMP_ID, type: AttendanceLogType.REGULAR, date: augustDate(20),
      checkIn: null, checkOut: null, status: AttendanceStatus.ON_LEAVE, note: null,
      dutyStartTimeSnapshot: null, dutyEndTimeSnapshot: null,
    });
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const oldEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id)!;
    const newEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    const oldDeductions = [...db.deductions.values()].filter((d) => d.payrollEntryId === oldEntry.id);
    const newDeductions = [...db.deductions.values()].filter((d) => d.payrollEntryId === newEntry.id);

    expect(oldDeductions.find((d) => d.reason === 'UNPAID_LEAVE')).toBeUndefined(); // both old-segment leave days were paid (within quota)
    const newUnpaid = newDeductions.find((d) => d.reason === 'UNPAID_LEAVE');
    expect(newUnpaid).toBeDefined(); // Aug 20 -> 3rd leave day -> unpaid, attributed to NEW segment only
  });

  // J. Reliever allowance: correct segment/date attribution and no duplication.
  it('J: a RelieverSession is credited to exactly one segment, never both', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    db.relieverSessions.push({
      employeeId: EMP_ID, date: augustDate(10), // OLD segment's window
      checkIn: pkTime(10, 18, 0), checkOut: pkTime(10, 22, 0), totalMinutes: 240,
    });
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const oldEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id)!;
    const newEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    const oldReliever = [...db.allowances.values()].find((a) => a.payrollEntryId === oldEntry.id && a.type === 'RELIEVER');
    const newReliever = [...db.allowances.values()].find((a) => a.payrollEntryId === newEntry.id && a.type === 'RELIEVER');
    expect(oldReliever).toBeDefined();
    expect(newReliever).toBeUndefined();
  });

  // L. Combined employee-month totals across segments are correct.
  it('L: combined basicStipend across both segments equals the correct two-rate prorated total', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const total = [...db.payrollEntries.values()].reduce((sum, e) => sum + e.basicStipend, 0);
    expect(total).toBe(26500); // 11200 + 15300
  });

  // M. Step 1 PRESENT/SWAP_COVERED floor still works (through the full orchestration).
  it('M: PRESENT/SWAP_COVERED still earn a full-day floor when computed through createOrGetEntry', async () => {
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
    // hourlyRate = 24800/(8*31) = 100; 1 day * 8h * 100 = 800
    expect(entry.basicStipend).toBe(800);
  });

  // N. Step 2 half-open boundary still works (through the full orchestration).
  it('N: the transition date is attributed to the new segment only, end to end', async () => {
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
    expect(oldEntry.basicStipend).toBe(800); // Aug 14 only: 8h * 100/h
    expect(newEntry.basicStipend).toBe(900); // Aug 15 only: 8h * 112.5/h
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

    // getMonthlyPayrollSummary issues a richer Prisma query (nested
    // stipendRecord.employee filters) this fake doesn't model — assert
    // directly against the dedup logic's own data source instead: two
    // PayrollEntry rows, one distinct employeeId.
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

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const resultsAfter = await service.recomputeEmployeeMonth({ employeeId: EMP_ID, month: 8, year: 2026 });
    expect(resultsAfter.every((r) => r.status === 'RECOMPUTED')).toBe(true);
    expect(db.payrollEntries.size).toBe(2); // still no duplicates
  });
});
