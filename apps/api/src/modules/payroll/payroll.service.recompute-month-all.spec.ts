import { AttendanceLogType, AttendanceStatus, PayrollStatus } from '@prisma/client';
import { PayrollService } from './payroll.service';

jest.mock('../attendance/discipline.helper', () => ({
  repairLateDisciplineForPayrollMonth: jest.fn().mockResolvedValue({
    applied: 0,
    repaired: 0,
    skipped: 0,
  }),
}));

/**
 * Coverage for recomputeMonthAll — the bulk, generic-by-month/year
 * recompute mechanism for EXISTING stale payroll data (built for the
 * August 2026 cleanup after Steps 1-6). This delegates every actual
 * recompute to the already-tested recomputeEmployeeMonth (see
 * payroll.service.segmentation.spec.ts) and adds only
 * discovery/orchestration/reporting on top — this suite exercises that
 * orchestration layer: employee-level (not row-level) processing,
 * PROCESSED/PAID always frozen, dry-run zero-mutation, the apply
 * confirmation guard, failure isolation, and idempotent re-runs.
 *
 * Uses the same in-memory FakeDb double as
 * payroll.service.segmentation.spec.ts, extended to support multiple
 * employees and PayrollEntry.findMany's various where-shapes.
 */

let idCounter = 0;
function newId(prefix: string) {
  idCounter++;
  return `${prefix}-${idCounter}`;
}

type FakeEmployee = {
  id: string;
  employeeCode: string;
  fullName: string;
  status: string;
  dutyTotalHours: number | null;
  dutyStartTime: string | null;
  dutyEndTime: string | null;
  monthlyAllowedLeaves: number | null;
  relieverOnly: boolean;
  shift: null;
};

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
  employees = new Map<string, FakeEmployee>();
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
      findMany: async ({ where, include }: any) => {
        let list = [...db.payrollEntries.values()];
        if (where.id?.in) {
          const ids: string[] = where.id.in;
          list = list.filter((e) => ids.includes(e.id));
        }
        if (where.month !== undefined) list = list.filter((e) => e.month === where.month);
        if (where.year !== undefined) list = list.filter((e) => e.year === where.year);
        if (where.status) {
          const allowed = where.status.in ?? [where.status];
          list = list.filter((e) => allowed.includes(e.status));
        }
        if (where.stipendRecordId?.in) {
          const ids: string[] = where.stipendRecordId.in;
          list = list.filter((e) => ids.includes(e.stipendRecordId));
        }
        if (where.stipendRecord?.employeeId) {
          const employeeId: string = where.stipendRecord.employeeId;
          list = list.filter((e) => db.stipendRecords.get(e.stipendRecordId)?.employeeId === employeeId);
        }
        return list.map((e) => hydrate(e, include));
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
      delete: async ({ where }: any) => {
        db.payrollEntries.delete(where.id);
      },
    },
    stipendReceipt: {
      deleteMany: async () => ({ count: 0 }),
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
      ...(include.stipendRecord
        ? { stipendRecord: { employeeId: db.stipendRecords.get(entry.stipendRecordId)?.employeeId } }
        : {}),
    };
  }

  return prisma;
}

function makeService(db: FakeDb) {
  const prisma = makeFakePrisma(db);
  const accessScopeService = { assertEmployeeAccess: jest.fn().mockResolvedValue(undefined) };
  return new PayrollService(prisma as any, accessScopeService as any);
}

const ACTING_USER = { id: 'user-1', role: 'HR_ADMIN' as any };

function augustDate(day: number): Date {
  return new Date(Date.UTC(2026, 7, day, 0, 0, 0));
}
function pkTime(day: number, hours: number, minutes = 0): Date {
  return new Date(Date.UTC(2026, 7, day, hours - 5, minutes, 0));
}

function seedEmployee(db: FakeDb, id: string, overrides: Partial<FakeEmployee> = {}) {
  db.employees.set(id, {
    id,
    employeeCode: `E-${id}`,
    fullName: `Employee ${id}`,
    status: 'ACTIVE',
    dutyTotalHours: 8,
    dutyStartTime: null,
    dutyEndTime: null,
    monthlyAllowedLeaves: null,
    relieverOnly: false,
    shift: null,
    ...overrides,
  });
}

function seedStipend(db: FakeDb, employeeId: string, basicStipend: number, effectiveFrom: Date, effectiveTo: Date | null): FakeStipendRecord {
  const r: FakeStipendRecord = {
    id: newId('sr'),
    employeeId,
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

function seedPayrollEntry(
  db: FakeDb,
  stipendRecordId: string,
  status: PayrollStatus,
  overrides: Partial<FakePayrollEntry> = {},
): FakePayrollEntry {
  const e: FakePayrollEntry = {
    id: newId('pe'),
    stipendRecordId,
    month: 8,
    year: 2026,
    status,
    basicStipend: 1000,
    totalAllowances: 0,
    totalDeductions: 0,
    netStipend: 1000,
    forcedNonActive: false,
    ...overrides,
  };
  db.payrollEntries.set(e.id, e);
  return e;
}

function seedFullMonthPresent(db: FakeDb, employeeId: string, days: number[] = Array.from({ length: 31 }, (_, i) => i + 1)) {
  for (const day of days) {
    db.attendanceLogs.push({
      employeeId,
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
const CONFIRM = 'RECOMPUTE_PENDING_PAYROLL';

describe('PayrollService.recomputeMonthAll', () => {
  // A. Dry run causes zero mutations.
  it('A: dry run makes zero database mutations', async () => {
    const db = new FakeDb();
    seedEmployee(db, 'e1');
    const sr = seedStipend(db, 'e1', 24800, new Date(Date.UTC(2000, 0, 1)), null);
    const entry = seedPayrollEntry(db, sr.id, PayrollStatus.PENDING, { basicStipend: 4489.97, netStipend: 4489.97 });
    seedFullMonthPresent(db, 'e1');
    const service = makeService(db);

    const before = { ...db.payrollEntries.get(entry.id)! };
    const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: true }, ACTING_USER);

    expect(result.dryRun).toBe(true);
    expect(db.payrollEntries.get(entry.id)).toEqual(before); // byte-for-byte unchanged
    expect(db.deductions.size).toBe(0);
    expect(db.allowances.size).toBe(0);
  });

  // B. Dry run reports correct unique employee count.
  it('B: dry run reports the correct unique employee count (not row count)', async () => {
    const db = new FakeDb();
    seedEmployee(db, 'e1');
    const oldSr = seedStipend(db, 'e1', 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 'e1', 27900, AUG_15, null);
    seedPayrollEntry(db, oldSr.id, PayrollStatus.PENDING);
    seedPayrollEntry(db, newSr.id, PayrollStatus.PENDING);
    seedEmployee(db, 'e2');
    const sr2 = seedStipend(db, 'e2', 20000, new Date(Date.UTC(2000, 0, 1)), null);
    seedPayrollEntry(db, sr2.id, PayrollStatus.PENDING);
    const service = makeService(db);

    const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: true }, ACTING_USER);

    expect(result.totalEmployeesInScope).toBe(2); // e1 (2 rows) + e2 (1 row) = 2 unique employees
    expect(result.batchEmployeesFound).toBe(2); // default limit 25 covers both
    expect(result.segmentsRecomputed).toBe(3); // 3 PENDING segments total would be recomputed
  });

  // C. Single PENDING employee recomputes.
  it('C: a single-segment PENDING employee is recomputed via recomputeEmployeeMonth', async () => {
    const db = new FakeDb();
    seedEmployee(db, 'e1');
    const sr = seedStipend(db, 'e1', 24800, new Date(Date.UTC(2000, 0, 1)), null);
    const entry = seedPayrollEntry(db, sr.id, PayrollStatus.PENDING, { basicStipend: 4489.97, netStipend: 4489.97 });
    seedFullMonthPresent(db, 'e1');
    const service = makeService(db);

    const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM }, ACTING_USER);

    expect(result.employeesProcessed).toBe(1);
    expect(result.segmentsRecomputed).toBe(1);
    const after = db.payrollEntries.get(entry.id)!;
    expect(after.basicStipend).toBe(24800); // full month present, single segment => full accrual
  });

  // D. Multi-segment PENDING employee recomputes once at employee level.
  // The closed old segment's PayrollEntry row is intentionally RETAINED
  // (pruneDuplicateOpenActivePayrollEntries only removes duplicate OPEN
  // segments, per its own doc comment — closed segments stay for audit
  // history), but per the 2026-09-04 rule its Basic is zeroed since the
  // active new segment now owns the whole month's Basic instead.
  it('D: a multi-segment PENDING employee keeps both rows; the closed segment is zeroed, the active one gets the full month', async () => {
    const db = new FakeDb();
    seedEmployee(db, 'e1');
    const oldSr = seedStipend(db, 'e1', 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 'e1', 27900, AUG_15, null);
    const oldEntry = seedPayrollEntry(db, oldSr.id, PayrollStatus.PENDING);
    const newEntry = seedPayrollEntry(db, newSr.id, PayrollStatus.PENDING);
    seedFullMonthPresent(db, 'e1');
    const service = makeService(db);

    const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM }, ACTING_USER);

    expect(result.totalEmployeesInScope).toBe(1);
    expect(result.employeesProcessed).toBe(1);
    expect(db.payrollEntries.get(oldEntry.id)!.basicStipend).toBe(0);
    expect(db.payrollEntries.get(newEntry.id)!.basicStipend).toBe(27900);
  });

  it('E: an employee whose only segment is PROCESSED is skipped, never mutated', async () => {
    const db = new FakeDb();
    seedEmployee(db, 'e1');
    const sr = seedStipend(db, 'e1', 24800, new Date(Date.UTC(2000, 0, 1)), null);
    const entry = seedPayrollEntry(db, sr.id, PayrollStatus.PROCESSED, { basicStipend: 0, netStipend: 0 });
    seedFullMonthPresent(db, 'e1');
    const service = makeService(db);

    const before = { ...db.payrollEntries.get(entry.id)! };
    const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM }, ACTING_USER);

    expect(result.employeesSkipped).toBe(1);
    expect(result.employeesProcessed).toBe(0);
    expect(db.payrollEntries.get(entry.id)).toEqual(before);
    expect(db.payrollEntries.get(entry.id)!.status).toBe(PayrollStatus.PROCESSED);
  });

  // F. PAID employee skipped.
  it('F: an employee whose only segment is PAID is skipped entirely, never mutated', async () => {
    const db = new FakeDb();
    seedEmployee(db, 'e1');
    const sr = seedStipend(db, 'e1', 24800, new Date(Date.UTC(2000, 0, 1)), null);
    const entry = seedPayrollEntry(db, sr.id, PayrollStatus.PAID, { basicStipend: 4489.97, netStipend: 4489.97 });
    seedFullMonthPresent(db, 'e1');
    const service = makeService(db);

    const before = { ...db.payrollEntries.get(entry.id)! };
    const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM }, ACTING_USER);

    expect(result.employeesSkipped).toBe(1);
    expect(db.payrollEntries.get(entry.id)).toEqual(before);
  });

  it('G: a mixed PROCESSED+PENDING employee freezes PROCESSED and refreshes PENDING', async () => {
    const db = new FakeDb();
    seedEmployee(db, 'e1');
    const oldSr = seedStipend(db, 'e1', 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 'e1', 27900, AUG_15, null);
    const oldEntry = seedPayrollEntry(db, oldSr.id, PayrollStatus.PROCESSED, { basicStipend: 1, totalDeductions: 0, netStipend: 1 });
    const newEntry = seedPayrollEntry(db, newSr.id, PayrollStatus.PENDING);
    seedFullMonthPresent(db, 'e1');
    const service = makeService(db);

    const frozenBefore = { ...db.payrollEntries.get(oldEntry.id)! };
    const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM }, ACTING_USER);

    expect(result.employeesProcessed).toBe(1);
    const employeeResult = result.results.find((r) => r.employeeId === 'e1')!;
    expect(employeeResult.status).toBe('PARTIAL_RECOMPUTE');
    expect(db.payrollEntries.get(oldEntry.id)).toEqual(frozenBefore);
    expect(db.payrollEntries.get(oldEntry.id)?.status).toBe(PayrollStatus.PROCESSED);
    expect(db.payrollEntries.get(newEntry.id)!.basicStipend).toBe(27900);
  });

  // H. Employee with no existing PayrollEntry is never created.
  it('H: an employee with no existing August PayrollEntry is never discovered or created', async () => {
    const db = new FakeDb();
    seedEmployee(db, 'e1');
    const sr1 = seedStipend(db, 'e1', 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedPayrollEntry(db, sr1.id, PayrollStatus.PENDING);
    seedFullMonthPresent(db, 'e1');
    // e2 has a stipend record and attendance but NO PayrollEntry yet.
    seedEmployee(db, 'e2');
    seedStipend(db, 'e2', 20000, new Date(Date.UTC(2000, 0, 1)), null);
    seedFullMonthPresent(db, 'e2');
    const service = makeService(db);

    const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM }, ACTING_USER);

    expect(result.totalEmployeesInScope).toBe(1); // only e1
    expect(result.results.some((r) => r.employeeId === 'e2')).toBe(false);
    const e2Entries = [...db.payrollEntries.values()].filter((e) =>
      db.stipendRecords.get(e.stipendRecordId)?.employeeId === 'e2',
    );
    expect(e2Entries).toHaveLength(0); // never created
  });

  // I. One employee failure does not abort remaining employees.
  it('I: one employee throwing does not abort the run — remaining employees still process, failure recorded', async () => {
    const db = new FakeDb();
    seedEmployee(db, 'e1');
    const sr1 = seedStipend(db, 'e1', 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedPayrollEntry(db, sr1.id, PayrollStatus.PENDING);
    seedFullMonthPresent(db, 'e1');

    // e2 has a valid StipendRecord + PENDING PayrollEntry (so discovery
    // finds it) but NO Employee row — forces recomputeEmployeeMonth's own
    // `if (!employee) throw NotFoundException` when this employee's turn
    // comes up, without corrupting discovery of e1/e3.
    const sr2 = seedStipend(db, 'e2', 18000, new Date(Date.UTC(2000, 0, 1)), null);
    seedPayrollEntry(db, sr2.id, PayrollStatus.PENDING);

    seedEmployee(db, 'e3');
    const sr3 = seedStipend(db, 'e3', 20000, new Date(Date.UTC(2000, 0, 1)), null);
    const entry3 = seedPayrollEntry(db, sr3.id, PayrollStatus.PENDING);
    seedFullMonthPresent(db, 'e3');

    const service = makeService(db);
    const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM }, ACTING_USER);

    expect(result.totalEmployeesInScope).toBe(3);
    expect(result.employeesFailed).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].employeeId).toBe('e2');
    // e1 and e3 still processed despite e2's failure.
    expect(result.employeesProcessed).toBe(2);
    expect(db.payrollEntries.get(entry3.id)!.basicStipend).toBe(20000);
  });

  // J. Duplicate PayrollEntry rows are not created.
  it('J: re-running the endpoint never creates duplicate PayrollEntry rows', async () => {
    const db = new FakeDb();
    seedEmployee(db, 'e1');
    const sr = seedStipend(db, 'e1', 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedPayrollEntry(db, sr.id, PayrollStatus.PENDING);
    seedFullMonthPresent(db, 'e1');
    const service = makeService(db);

    await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM }, ACTING_USER);
    await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM }, ACTING_USER);

    expect(db.payrollEntries.size).toBe(1);
  });

  // K. Deduction/allowance rows remain idempotent on rerun.
  it('K: re-running the endpoint does not duplicate deduction/allowance rows', async () => {
    const db = new FakeDb();
    seedEmployee(db, 'e1', { monthlyAllowedLeaves: 2 });
    const sr = seedStipend(db, 'e1', 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedPayrollEntry(db, sr.id, PayrollStatus.PENDING);
    seedFullMonthPresent(db, 'e1', [1, 2]);
    // 3 ON_LEAVE days -> allowance 2 -> 1 unpaid leave day. 2026-09-04
    // rewrite: the unpaid day beyond quota is excluded from payableDays
    // (Basic loses its share) — it no longer creates a separate
    // UNPAID_LEAVE PayrollDeduction row (removed to avoid double-charging
    // the same day), so idempotency is checked on ADDITIONAL_WORKING_DAYS
    // only, plus asserting no stray UNPAID_LEAVE row ever appears.
    for (const day of [5, 6, 7]) {
      db.attendanceLogs.push({
        employeeId: 'e1', type: AttendanceLogType.REGULAR, date: augustDate(day),
        checkIn: null, checkOut: null, status: AttendanceStatus.ON_LEAVE, note: null,
        dutyStartTimeSnapshot: null, dutyEndTimeSnapshot: null,
      });
    }
    db.additionalWorkingDays.push({ employeeId: 'e1', date: augustDate(20), note: null });
    const service = makeService(db);

    await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM }, ACTING_USER);
    await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM }, ACTING_USER);
    await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM }, ACTING_USER);

    const unpaidLeaveDeds = [...db.deductions.values()].filter((d) => d.reason === 'UNPAID_LEAVE');
    const awdAllowances = [...db.allowances.values()].filter((a) => a.type === 'ADDITIONAL_WORKING_DAYS');
    expect(unpaidLeaveDeds).toHaveLength(0); // no longer created at all
    expect(awdAllowances).toHaveLength(1); // never duplicated across 3 runs
  });

  // L. Explicit confirmation required for apply.
  it('L: a non-dry-run request without the exact confirm text is rejected and makes zero mutations', async () => {
    const db = new FakeDb();
    seedEmployee(db, 'e1');
    const sr = seedStipend(db, 'e1', 24800, new Date(Date.UTC(2000, 0, 1)), null);
    const entry = seedPayrollEntry(db, sr.id, PayrollStatus.PENDING, { basicStipend: 4489.97, netStipend: 4489.97 });
    seedFullMonthPresent(db, 'e1');
    const service = makeService(db);

    const before = { ...db.payrollEntries.get(entry.id)! };
    await expect(
      service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: 'wrong' } as any, ACTING_USER),
    ).rejects.toThrow();
    await expect(
      service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false } as any, ACTING_USER),
    ).rejects.toThrow();

    expect(db.payrollEntries.get(entry.id)).toEqual(before); // zero mutations either way
  });

  // N. Summary totals use actual physical database state after recompute.
  it('N: reported afterTotals match the actual physical PayrollEntry rows post-recompute', async () => {
    const db = new FakeDb();
    seedEmployee(db, 'e1');
    const sr1 = seedStipend(db, 'e1', 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedPayrollEntry(db, sr1.id, PayrollStatus.PENDING, { basicStipend: 4489.97, netStipend: 4489.97 });
    seedFullMonthPresent(db, 'e1');

    seedEmployee(db, 'e2');
    const sr2 = seedStipend(db, 'e2', 20000, new Date(Date.UTC(2000, 0, 1)), null);
    const frozenEntry = seedPayrollEntry(db, sr2.id, PayrollStatus.PAID, { basicStipend: 3000, netStipend: 3000 });
    seedFullMonthPresent(db, 'e2');

    const service = makeService(db);
    const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM }, ACTING_USER);

    const physicalTotal = [...db.payrollEntries.values()].reduce(
      (sum, e) => sum + e.basicStipend,
      0,
    );
    expect(result.afterTotals.basicStipend).toBeCloseTo(physicalTotal, 5);
    // e1 recomputed to full month (24800), e2 frozen at its seeded 3000.
    expect(result.afterTotals.basicStipend).toBeCloseTo(24800 + 3000, 5);
    expect(db.payrollEntries.get(frozenEntry.id)!.basicStipend).toBe(3000); // frozen entry unchanged
  });

  // ── Batching (offset/limit at unique-employee level) ────────────────

  function seedManyEmployees(db: FakeDb, count: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      // Zero-padded so lexicographic (default sort()) order matches
      // numeric order, keeping assertions below simple to reason about.
      const id = `emp-${String(i).padStart(3, '0')}`;
      ids.push(id);
      seedEmployee(db, id);
      const sr = seedStipend(db, id, 20000, new Date(Date.UTC(2000, 0, 1)), null);
      seedPayrollEntry(db, sr.id, PayrollStatus.PENDING);
    }
    return ids;
  }

  it('batch 1 of 25: default limit returns exactly 25 employees, hasMore true, nextOffset 25', async () => {
    const db = new FakeDb();
    const allIds = seedManyEmployees(db, 30);
    const service = makeService(db);

    const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: true }, ACTING_USER);

    expect(result.totalEmployeesInScope).toBe(30);
    expect(result.limit).toBe(25);
    expect(result.offset).toBe(0);
    expect(result.batchEmployeesFound).toBe(25);
    expect(result.nextOffset).toBe(25);
    expect(result.hasMore).toBe(true);
    expect(result.results.map((r) => r.employeeId)).toEqual(allIds.slice(0, 25));
  });

  it('next batch at offset 25: returns the final partial batch of 5, hasMore false', async () => {
    const db = new FakeDb();
    const allIds = seedManyEmployees(db, 30);
    const service = makeService(db);

    const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: true, offset: 25 }, ACTING_USER);

    expect(result.totalEmployeesInScope).toBe(30);
    expect(result.offset).toBe(25);
    expect(result.batchEmployeesFound).toBe(5); // final partial batch
    expect(result.nextOffset).toBe(30);
    expect(result.hasMore).toBe(false);
    expect(result.results.map((r) => r.employeeId)).toEqual(allIds.slice(25, 30));
  });

  it('deterministic ordering: repeated calls with the same offset/limit return the identical employee slice', async () => {
    const db = new FakeDb();
    seedManyEmployees(db, 12);
    const service = makeService(db);

    const first = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: true, limit: 5, offset: 3 }, ACTING_USER);
    const second = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: true, limit: 5, offset: 3 }, ACTING_USER);

    expect(first.results.map((r) => r.employeeId)).toEqual(second.results.map((r) => r.employeeId));
  });

  it('no duplicate employee across batches: paging through via nextOffset visits every employee exactly once', async () => {
    const db = new FakeDb();
    const allIds = seedManyEmployees(db, 23);
    const service = makeService(db);

    const seen: string[] = [];
    let offset = 0;
    const limit = 7;
    // Loop bound generously; the assertions below are what actually prove
    // termination/correctness, not this bound.
    for (let i = 0; i < 10; i++) {
      const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: false, confirm: CONFIRM, limit, offset }, ACTING_USER);
      seen.push(...result.results.map((r) => r.employeeId));
      if (!result.hasMore) break;
      offset = result.nextOffset;
    }

    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23); // no duplicates
    expect([...seen].sort()).toEqual(allIds); // every employee visited
  });

  it('limit is capped at 50 by the DTO even if a caller requests more', async () => {
    const db = new FakeDb();
    seedManyEmployees(db, 5);
    const service = makeService(db);

    const result = await service.recomputeMonthAll({ month: 8, year: 2026, dryRun: true, limit: 999 } as any, ACTING_USER);
    expect(result.limit).toBe(50); // service-level defensive re-clamp
  });
});
