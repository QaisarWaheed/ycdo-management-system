import { AttendanceLogType, AttendanceStatus, PayrollStatus } from '@prisma/client';
import { PayrollService } from './payroll.service';

/**
 * Coverage for the new PERMANENT-behavior centralized hook,
 * recomputePendingPayrollForAttendanceDate — the single entry point every
 * attendance/leave/swap mutation path now calls after its own write
 * commits, so a PENDING PayrollEntry never goes stale the way the August
 * 2026 data did before Steps 1-6's one-time cleanup.
 *
 * This tests the hook's own logic exhaustively: month/year derivation
 * from the attendance business date (never wall-clock), the
 * never-auto-create guard, frozen (PROCESSED/PAID) segments staying
 * untouched, idempotency, and multi-segment correctness. It adds zero new
 * calculation logic of its own (delegates to the already-tested
 * recomputeEmployeeMonth — see payroll.service.segmentation.spec.ts), so
 * this suite is about the hook's own decision logic, not re-proving
 * payroll math already covered elsewhere.
 *
 * Uses the same in-memory FakeDb double as
 * payroll.service.segmentation.spec.ts, extended with
 * PayrollEntry.findFirst (the hook's own existence-check query).
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
      findFirst: async ({ where }: any) => {
        const employeeId: string = where.stipendRecord.employeeId;
        const entry = [...db.payrollEntries.values()].find(
          (e) =>
            e.month === where.month &&
            e.year === where.year &&
            db.stipendRecords.get(e.stipendRecordId)?.employeeId === employeeId,
        );
        return entry ? { id: entry.id } : null;
      },
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

function augustDate(day: number): Date {
  return new Date(Date.UTC(2026, 7, day, 0, 0, 0));
}
function septemberDate(day: number): Date {
  return new Date(Date.UTC(2026, 8, day, 0, 0, 0));
}
function pkTime(day: number, hours: number, minutes = 0): Date {
  return new Date(Date.UTC(2026, 7, day, hours - 5, minutes, 0));
}

const EMP_ID = 'emp-hook-1';

function seedEmployee(db: FakeDb, overrides: Partial<any> = {}) {
  db.employees.set(EMP_ID, {
    id: EMP_ID,
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

function seedPayrollEntry(db: FakeDb, stipendRecordId: string, month: number, year: number, status: PayrollStatus, overrides: Partial<FakePayrollEntry> = {}): FakePayrollEntry {
  const e: FakePayrollEntry = {
    id: newId('pe'),
    stipendRecordId,
    month,
    year,
    status,
    basicStipend: 0,
    totalAllowances: 0,
    totalDeductions: 0,
    netStipend: 0,
    forcedNonActive: false,
    ...overrides,
  };
  db.payrollEntries.set(e.id, e);
  return e;
}

function seedPresentDay(db: FakeDb, day: number, status: AttendanceStatus = AttendanceStatus.PRESENT) {
  db.attendanceLogs.push({
    employeeId: EMP_ID,
    type: AttendanceLogType.REGULAR,
    date: augustDate(day),
    checkIn: pkTime(day, 9, 0),
    checkOut: pkTime(day, 17, 0),
    status,
    note: null,
    dutyStartTimeSnapshot: null,
    dutyEndTimeSnapshot: null,
  });
}

const AUG_15 = new Date(Date.UTC(2026, 7, 15, 0, 0, 0));

describe('PayrollService.recomputePendingPayrollForAttendanceDate', () => {
  // 1. UNMARKED -> PRESENT automatically increases PENDING accrued basic.
  it('1: UNMARKED (no credit) -> PRESENT (full credit) increases the PENDING basicStipend', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const sr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedPayrollEntry(db, sr.id, 8, 2026, PayrollStatus.PENDING, { basicStipend: 0, netStipend: 0 });
    // No attendance logs at all yet — every day contributes 0.
    const service = makeService(db);

    await service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(10));
    const before = [...db.payrollEntries.values()][0];
    expect(before.basicStipend).toBe(0); // still nothing recorded

    // Now the day is marked PRESENT (simulating markManual's write already
    // having committed) and the hook fires again.
    seedPresentDay(db, 10);
    await service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(10));

    const after = [...db.payrollEntries.values()][0];
    expect(after.basicStipend).toBeGreaterThan(0); // 8h * 100/hr = 800
    expect(after.basicStipend).toBe(800);
  });

  // 2. PRESENT -> ABSENT automatically reconciles PENDING payroll.
  // Note: under the established Step 1-3 policy, ABSENT gets the SAME
  // full-day policy-credit floor as PRESENT (the financial consequence of
  // an absence is the discipline deduction, not a basicStipend cut) — so
  // basicStipend is expected to stay the SAME here, not drop. This proves
  // the hook correctly reconciles the recompute for the new status
  // without introducing a double-count or miscalculation, which is the
  // meaningful thing to verify at this (payroll-only, discipline-free)
  // layer — the deduction side is discipline.helper.ts's job and is
  // covered by the existing discipline suites (see Steps 4-6).
  it('2: PRESENT -> ABSENT recomputes cleanly and basicStipend stays correctly floored (no double-credit, no miscalculation)', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const sr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedPayrollEntry(db, sr.id, 8, 2026, PayrollStatus.PENDING);
    seedPresentDay(db, 10);
    const service = makeService(db);

    await service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(10));
    const afterPresent = [...db.payrollEntries.values()][0].basicStipend;

    db.attendanceLogs.find((l) => l.date.getTime() === augustDate(10).getTime())!.status =
      AttendanceStatus.ABSENT;
    await service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(10));
    const afterAbsent = [...db.payrollEntries.values()][0].basicStipend;

    expect(afterAbsent).toBe(afterPresent); // 800 either way — full-day floor both statuses
    expect(afterAbsent).toBe(800);
  });

  // 3. Historical August correction made later recomputes August, not the
  // "current" month — the hook has no wall-clock dependency at all; it
  // derives month/year purely from the passed attendanceDate.
  it('3: a historical August date recomputes ONLY the August PayrollEntry, a September entry is untouched', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const sr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    const augEntry = seedPayrollEntry(db, sr.id, 8, 2026, PayrollStatus.PENDING, { basicStipend: 0, netStipend: 0 });
    const sepEntry = seedPayrollEntry(db, sr.id, 9, 2026, PayrollStatus.PENDING, { basicStipend: 12345, netStipend: 12345 });
    seedPresentDay(db, 10);
    const service = makeService(db);

    // Simulates: HR corrects an August 10 record while "today" is actually
    // in September — the hook is called with the August business date,
    // never a wall-clock "now".
    await service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(10));

    expect(db.payrollEntries.get(augEntry.id)!.basicStipend).toBe(800); // August recomputed
    expect(db.payrollEntries.get(sepEntry.id)!.basicStipend).toBe(12345); // September untouched
  });

  // 6. PROCESSED payroll remains financially unchanged.
  it('6: a PROCESSED PayrollEntry is never mutated by the hook', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const sr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    const entry = seedPayrollEntry(db, sr.id, 8, 2026, PayrollStatus.PROCESSED, { basicStipend: 4489.97, totalDeductions: 500, netStipend: 3989.97 });
    seedPresentDay(db, 10);
    const before = { ...db.payrollEntries.get(entry.id)! };
    const service = makeService(db);

    await service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(10));

    expect(db.payrollEntries.get(entry.id)).toEqual(before);
  });

  // 7. PAID payroll remains financially unchanged.
  it('7: a PAID PayrollEntry is never mutated by the hook', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const sr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    const entry = seedPayrollEntry(db, sr.id, 8, 2026, PayrollStatus.PAID, { basicStipend: 24800, netStipend: 24800 });
    seedPresentDay(db, 10);
    const before = { ...db.payrollEntries.get(entry.id)! };
    const service = makeService(db);

    await service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(10));

    expect(db.payrollEntries.get(entry.id)).toEqual(before);
  });

  // 8. No PayrollEntry -> no accidental payroll creation.
  it('8: an employee with no existing August PayrollEntry gets nothing created by the hook', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedPresentDay(db, 10);
    // Deliberately no seedPayrollEntry call.
    const service = makeService(db);

    await service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(10));

    expect(db.payrollEntries.size).toBe(0);
  });

  // 9. Repeating the same attendance update remains idempotent.
  it('9: calling the hook repeatedly for the same unchanged state never duplicates rows or drifts totals', async () => {
    const db = new FakeDb();
    seedEmployee(db, { monthlyAllowedLeaves: 2 });
    const sr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedPayrollEntry(db, sr.id, 8, 2026, PayrollStatus.PENDING);
    seedPresentDay(db, 10);
    db.additionalWorkingDays.push({ employeeId: EMP_ID, date: augustDate(20), note: null });
    const service = makeService(db);

    await service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(10));
    const first = { ...[...db.payrollEntries.values()][0] };

    await service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(10));
    await service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(10));
    const third = { ...[...db.payrollEntries.values()][0] };

    expect(third).toEqual(first);
    expect(db.payrollEntries.size).toBe(1); // no duplicate entries
    const awdAllowances = [...db.allowances.values()].filter((a) => a.type === 'ADDITIONAL_WORKING_DAYS');
    expect(awdAllowances).toHaveLength(1); // no duplicate allowance rows across 3 calls
  });

  // 10. Multi-stipend-segment month recomputes the correct affected
  // segment using the existing segmentation, leaving the other segment's
  // (independently correct) totals as-is.
  it('10: a correction to an OLD-segment date only changes the OLD segment; the NEW segment recomputes to the same correct value', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    const oldEntry = seedPayrollEntry(db, oldSr.id, 8, 2026, PayrollStatus.PENDING);
    const newEntry = seedPayrollEntry(db, newSr.id, 8, 2026, PayrollStatus.PENDING);
    // Full month present in both segments' windows.
    for (let day = 1; day <= 31; day++) seedPresentDay(db, day);
    const service = makeService(db);

    await service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(5)); // OLD segment's window

    // OLD segment: 14 days (Aug 1-14) * 8h * 100/hr = 11200.
    expect(db.payrollEntries.get(oldEntry.id)!.basicStipend).toBe(11200);
    // NEW segment: 17 days (Aug 15-31) * 8h * 112.5/hr = 15300 — recomputed
    // too (recomputeEmployeeMonth refreshes every overlapping PENDING
    // segment together), but correctly unaffected by the Aug 5 correction
    // since that date falls outside its own window.
    expect(db.payrollEntries.get(newEntry.id)!.basicStipend).toBe(15300);
  });

  // Additional: hook never even queries StipendRecord/AttendanceLog beyond
  // the existence check when no entry exists — confirms the "avoid
  // unnecessary recomputation" requirement, not just "no creation".
  it('extra: when no PayrollEntry exists, recomputeEmployeeMonth is never invoked at all', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    const service = makeService(db);
    const spy = jest.spyOn(service, 'recomputeEmployeeMonth');

    await service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(10));

    expect(spy).not.toHaveBeenCalled();
  });

  it('extra: never throws even if the underlying recompute fails', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const sr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedPayrollEntry(db, sr.id, 8, 2026, PayrollStatus.PENDING);
    const service = makeService(db);
    jest.spyOn(service, 'recomputeEmployeeMonth').mockRejectedValue(new Error('boom'));

    await expect(
      service.recomputePendingPayrollForAttendanceDate(EMP_ID, augustDate(10)),
    ).resolves.toBeUndefined();
  });
});
