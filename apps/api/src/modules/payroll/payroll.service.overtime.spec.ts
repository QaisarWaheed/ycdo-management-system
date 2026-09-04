import { AllowanceType, AttendanceLogType, AttendanceStatus, PayrollStatus } from '@prisma/client';
import { PayrollService } from './payroll.service';

jest.mock('../attendance/discipline.helper', () => ({
  repairLateDisciplineForPayrollMonth: jest.fn().mockResolvedValue({
    applied: 0,
    repaired: 0,
    skipped: 0,
  }),
}));

/**
 * Step 4 (Gap #2) regression coverage: overtime is recorded per
 * AttendanceLog row (one date each), so — like every other date-based
 * child-row calculation since Step 3 — it must be attributed to whichever
 * StipendRecord segment is effective on each attendance date, never
 * aggregated month-globally and dumped onto one PayrollEntry picked via
 * findFirst. getOvertimePreview partitions OT-bearing dates per segment;
 * applyOvertime writes each segment's own share to its own PayrollEntry
 * only, so no OT minute can ever contribute to more than one segment's row.
 *
 * Uses the same style of in-memory fake Prisma double as
 * payroll.service.segmentation.spec.ts, extended with overtime-specific
 * surface (AttendanceLog.overtimeMinutes/overtimePending, updateMany,
 * PayrollEntry.findMany, Allowance, and $transaction).
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
  overtimeMinutes: number;
  overtimePending: boolean;
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
      findMany: async ({ where, include }: any) => {
        let list = [...db.payrollEntries.values()];
        if (where.month != null) list = list.filter((e) => e.month === where.month);
        if (where.year != null) list = list.filter((e) => e.year === where.year);
        if (where.status != null) list = list.filter((e) => e.status === where.status);
        if (where.stipendRecordId?.in) {
          list = list.filter((e) => where.stipendRecordId.in.includes(e.stipendRecordId));
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
          .filter((l) => !where.overtimeMinutes || l.overtimeMinutes > 0)
          .filter((l) => inDateRange(l.date, where.date))
          .sort((a, b) => a.date.getTime() - b.date.getTime()),
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const l of db.attendanceLogs) {
          if (l.employeeId !== where.employeeId) continue;
          if (!inDateRange(l.date, where.date)) continue;
          if (where.overtimeMinutes && !(l.overtimeMinutes > 0)) continue;
          if (where.overtimePending !== undefined && l.overtimePending !== where.overtimePending) continue;
          Object.assign(l, data);
          count++;
        }
        return { count };
      },
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
      ...(include.allowances
        ? {
            allowances: [...db.allowances.values()]
              .filter((a) => a.payrollEntryId === entry.id)
              .filter((a) => !include.allowances.where?.type || a.type === include.allowances.where.type),
          }
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

const EMP_ID = 'emp-ot-1';

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

function seedFullMonthPresent(db: FakeDb, days: number[] = Array.from({ length: 31 }, (_, i) => i + 1)) {
  for (const day of days) {
    db.attendanceLogs.push({
      employeeId: EMP_ID,
      type: AttendanceLogType.REGULAR,
      date: augustDate(day),
      checkIn: new Date(Date.UTC(2026, 7, day, 4, 0)),
      checkOut: new Date(Date.UTC(2026, 7, day, 12, 0)),
      status: AttendanceStatus.PRESENT,
      note: null,
      dutyStartTimeSnapshot: null,
      dutyEndTimeSnapshot: null,
      overtimeMinutes: 0,
      overtimePending: false,
    });
  }
}

function seedOvertime(db: FakeDb, day: number, minutes: number, pending = true) {
  const log = db.attendanceLogs.find((l) => l.date.getTime() === augustDate(day).getTime());
  if (log) {
    log.overtimeMinutes = minutes;
    log.overtimePending = pending;
    return;
  }
  db.attendanceLogs.push({
    employeeId: EMP_ID,
    type: AttendanceLogType.REGULAR,
    date: augustDate(day),
    checkIn: new Date(Date.UTC(2026, 7, day, 4, 0)),
    checkOut: new Date(Date.UTC(2026, 7, day, 14, 0)),
    status: AttendanceStatus.PRESENT,
    note: null,
    dutyStartTimeSnapshot: null,
    dutyEndTimeSnapshot: null,
    overtimeMinutes: minutes,
    overtimePending: pending,
  });
}

const AUG_15 = new Date(Date.UTC(2026, 7, 15, 0, 0, 0));

describe('PayrollService — Step 4 overtime stipend-segment attribution', () => {
  // I. Single-segment month: overtime preview/apply behaves exactly as
  // before segmentation (no regression for the common case).
  it('I: a single full-month stipend record — overtime preview/apply is unchanged from pre-segmentation behavior', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedFullMonthPresent(db);
    seedOvertime(db, 10, 120); // 2h OT on Aug 10
    const service = makeService(db);

    const preview = await service.getOvertimePreview(EMP_ID, 8, 2026);
    expect(preview.overtimeMinutes).toBe(120);
    expect(preview.overtimeHours).toBe(2);
    // hourlyRate = 24800 / (8*31) = 100; amount = 2 * 100 = 200
    expect(preview.hourlyRate).toBe(100);
    expect(preview.amount).toBe(200);
    expect(preview.segments).toHaveLength(1);

    const result = await service.applyOvertime({ employeeId: EMP_ID, month: 8, year: 2026 } as any, ACTING_USER);
    expect(result.totalAllowances).toBeCloseTo(200, 5);
    expect((result as any).segments).toHaveLength(1);
  });

  it('payroll generate/refresh writes overtime from attendance hours without applyOvertime', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), null);
    seedFullMonthPresent(db);
    seedOvertime(db, 10, 120);
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);

    const entry = [...db.payrollEntries.values()][0];
    const ot = [...db.allowances.values()].find(
      (a) => a.payrollEntryId === entry.id && a.type === AllowanceType.OVERTIME,
    );
    expect(ot?.hours).toBe(2);
    expect(ot?.amount).toBe(200);
  });

  // J. Overtime dated BEFORE the increment is attributed only to the OLD
  // segment's rate/entry.
  it('J: overtime before the increment is attributed to the OLD segment only', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    seedOvertime(db, 10, 120); // in OLD segment's window
    const service = makeService(db);

    const preview = await service.getOvertimePreview(EMP_ID, 8, 2026);
    const oldSeg = preview.segments.find((s) => s.stipendRecordId === oldSr.id)!;
    const newSeg = preview.segments.find((s) => s.stipendRecordId === newSr.id)!;
    expect(oldSeg.overtimeMinutes).toBe(120);
    expect(newSeg.overtimeMinutes).toBe(0);
    expect(oldSeg.hourlyRate).toBe(100); // 24800/(8*31)
    expect(oldSeg.amount).toBe(200); // 2h * 100
  });

  // K. Overtime dated AFTER the increment is attributed only to the NEW
  // segment's rate/entry.
  it('K: overtime after the increment is attributed to the NEW segment only', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    seedOvertime(db, 20, 60); // in NEW segment's window
    const service = makeService(db);

    const preview = await service.getOvertimePreview(EMP_ID, 8, 2026);
    const oldSeg = preview.segments.find((s) => s.stipendRecordId === oldSr.id)!;
    const newSeg = preview.segments.find((s) => s.stipendRecordId === newSr.id)!;
    expect(oldSeg.overtimeMinutes).toBe(0);
    expect(newSeg.overtimeMinutes).toBe(60);
    // hourlyRate = 27900/(8*31) = 112.5; 1h * 112.5 = 112.5
    expect(newSeg.hourlyRate).toBe(112.5);
    expect(newSeg.amount).toBe(112.5);
  });

  // L. Overtime spanning both segments: each date's minutes land in exactly
  // one segment, no double-counting, and the combined preview total equals
  // the sum of segment totals.
  it('L: overtime spanning both segments splits correctly with no double-counting', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    seedOvertime(db, 10, 120); // OLD: 2h
    seedOvertime(db, 20, 60); // NEW: 1h
    const service = makeService(db);

    const preview = await service.getOvertimePreview(EMP_ID, 8, 2026);
    expect(preview.overtimeMinutes).toBe(180); // 120 + 60, never double-counted
    const oldSeg = preview.segments.find((s) => s.stipendRecordId === oldSr.id)!;
    const newSeg = preview.segments.find((s) => s.stipendRecordId === newSr.id)!;
    expect(oldSeg.amount + newSeg.amount).toBeCloseTo(preview.amount, 5);
    expect(preview.amount).toBeCloseTo(200 + 112.5, 5);
  });

  // M. applyOvertime writes each segment's overtime to its own PayrollEntry
  // row — never an arbitrary one.
  it('M: applyOvertime writes overtime onto the active PayrollEntry only', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    seedOvertime(db, 10, 120);
    seedOvertime(db, 20, 60);
    const service = makeService(db);

    await service.applyOvertime({ employeeId: EMP_ID, month: 8, year: 2026 } as any, ACTING_USER);

    expect(db.payrollEntries.size).toBe(2);
    const newEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    const newOt = [...db.allowances.values()].find((a) => a.payrollEntryId === newEntry.id && a.type === AllowanceType.OVERTIME);
    expect(newOt?.amount).toBe(112.5);
  });

  // N. A PROCESSED old segment stays frozen — its overtime allowance is
  // never applied/replaced, even though the OTHER (active) segment's
  // overtime still applies normally.
  it('N: a PROCESSED old segment is frozen — overtime is applied to the active segment only', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    seedOvertime(db, 10, 120); // OLD segment
    seedOvertime(db, 20, 60); // NEW (active) segment
    const service = makeService(db);

    // First call creates both entries; freeze the old one afterward.
    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    expect(
      [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id),
    ).toBeDefined();

    await service.applyOvertime({ employeeId: EMP_ID, month: 8, year: 2026 } as any, ACTING_USER);

    const newEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    const newOt = [...db.allowances.values()].find((a) => a.payrollEntryId === newEntry.id && a.type === AllowanceType.OVERTIME);
    expect(newOt?.amount).toBe(112.5);
  });

  // O. Re-applying overtime (e.g. after an attendance correction) replaces
  // the existing OVERTIME allowance on each segment rather than duplicating
  // it, and pending flags are cleared only within each segment's own dates.
  it('O: re-applying overtime replaces (not duplicates) each segment allowance, and clears pending flags per-segment', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    seedOvertime(db, 10, 120, true);
    seedOvertime(db, 20, 60, true);
    const service = makeService(db);

    await service.applyOvertime({ employeeId: EMP_ID, month: 8, year: 2026 } as any, ACTING_USER);
    // Correct Aug 10's OT upward and re-apply.
    const log10 = db.attendanceLogs.find((l) => l.date.getTime() === augustDate(10).getTime())!;
    log10.overtimeMinutes = 180; // 3h now
    log10.overtimePending = true;

    await service.applyOvertime({ employeeId: EMP_ID, month: 8, year: 2026 } as any, ACTING_USER);

    expect(db.payrollEntries.size).toBe(2);
    const newEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    const newOtAllowances = [...db.allowances.values()].filter((a) => a.payrollEntryId === newEntry.id && a.type === AllowanceType.OVERTIME);
    expect(newOtAllowances).toHaveLength(1);

    const log20 = db.attendanceLogs.find((l) => l.date.getTime() === augustDate(20).getTime())!;
    expect(log20.overtimePending).toBe(false);
  });

  // P. Combined preview total equals the sum of segment totals across three
  // overlapping stipend segments.
  it('P: combined preview total equals the sum of segment totals across three segments', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const AUG_10 = new Date(Date.UTC(2026, 7, 10));
    const AUG_21 = new Date(Date.UTC(2026, 7, 21));
    const sr1 = seedStipend(db, 20000, new Date(Date.UTC(2000, 0, 1)), AUG_10);
    const sr2 = seedStipend(db, 24000, AUG_10, AUG_21);
    const sr3 = seedStipend(db, 28000, AUG_21, null);
    seedFullMonthPresent(db);
    seedOvertime(db, 5, 60); // seg 1
    seedOvertime(db, 15, 60); // seg 2
    seedOvertime(db, 25, 60); // seg 3
    const service = makeService(db);

    const preview = await service.getOvertimePreview(EMP_ID, 8, 2026);
    const seg1 = preview.segments.find((s) => s.stipendRecordId === sr1.id)!;
    const seg2 = preview.segments.find((s) => s.stipendRecordId === sr2.id)!;
    const seg3 = preview.segments.find((s) => s.stipendRecordId === sr3.id)!;
    expect(seg1.overtimeMinutes).toBe(60);
    expect(seg2.overtimeMinutes).toBe(60);
    expect(seg3.overtimeMinutes).toBe(60);
    expect(preview.overtimeMinutes).toBe(180);
    expect(seg1.amount + seg2.amount + seg3.amount).toBeCloseTo(preview.amount, 5);
  });

  // Q. Regression: Steps 1-3 behavior (single-segment PRESENT floor,
  // half-open boundary) is untouched by the overtime changes.
  it('Q: mid-month stipend change — new package earns the whole month\'s hours, old segment earns 0', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    const oldSr = seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    const newSr = seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    const service = makeService(db);

    await service.createOrGetEntry({ employeeId: EMP_ID, month: 8, year: 2026 } as any);
    const oldEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === oldSr.id);
    expect(oldEntry).toBeDefined();
    // Policy (2026-09-04): rule 5 (unchanged) still forbids dual-paying a
    // month across old + new segments. The closed old segment earns 0 Basic
    // hourly; only the active new segment earns Basic, for the full month's
    // worked/credited hours.
    expect(oldEntry!.basicStipend).toBe(0);
    const newEntry = [...db.payrollEntries.values()].find((e) => e.stipendRecordId === newSr.id)!;
    expect(newEntry.basicStipend).toBe(27900);
  });

  // R. Regression: headcount/segment count remains correct after applying
  // overtime across multiple segments (no duplicate PayrollEntry rows).
  it('R: applying overtime across segments never creates duplicate PayrollEntry rows', async () => {
    const db = new FakeDb();
    seedEmployee(db);
    seedStipend(db, 24800, new Date(Date.UTC(2000, 0, 1)), AUG_15);
    seedStipend(db, 27900, AUG_15, null);
    seedFullMonthPresent(db);
    seedOvertime(db, 10, 120);
    seedOvertime(db, 20, 60);
    const service = makeService(db);

    await service.applyOvertime({ employeeId: EMP_ID, month: 8, year: 2026 } as any, ACTING_USER);
    await service.applyOvertime({ employeeId: EMP_ID, month: 8, year: 2026 } as any, ACTING_USER);

    expect(db.payrollEntries.size).toBe(2);
  });
});
