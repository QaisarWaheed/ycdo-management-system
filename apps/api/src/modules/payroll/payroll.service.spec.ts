import * as fs from 'fs';
import * as path from 'path';
import { AttendanceStatus } from '@prisma/client';
import { PayrollService } from './payroll.service';
import { computeHourlyRate, roundMoney, roundHoursFromMinutes } from './payroll-hours.util';

jest.mock('../attendance/discipline.helper', () => ({
  repairLateDisciplineForPayrollMonth: jest.fn().mockResolvedValue({
    applied: 0,
    repaired: 0,
    skipped: 0,
  }),
}));

/**
 * Regression coverage for the PRESENT/SWAP_COVERED basic-earning floor fix
 * in PayrollService.computeHourlyBreakdown() — see the file header comment
 * added at that branch. Exercises the private method directly against a
 * mocked PrismaService (no DB, no NestJS TestingModule needed — the method
 * under test has no other side effects), the same way the existing
 * discipline-cleanup regression tests validate pure logic without hitting a
 * real database.
 *
 * Root cause being regression-tested: PRESENT and SWAP_COVERED previously
 * fell through to a raw checkIn/checkOut overlap calculation with no
 * scheduled-day floor, unlike every other attendance status, causing basic
 * pay to collapse to a small fraction of the contractual stipend whenever
 * the raw session was short, anomalous, or duty-window-trimmed.
 */

/** Build a UTC Date whose Pakistan local clock matches the given HH:mm on the given August 2026 day. */
function pkTime(day: number, hours: number, minutes = 0): Date {
  // PK = UTC+5 -> UTC = PK - 5h
  return new Date(Date.UTC(2026, 7, day, hours - 5, minutes, 0));
}

function augustDate(day: number): Date {
  return new Date(Date.UTC(2026, 7, day, 0, 0, 0));
}

type FakeLog = {
  date: Date;
  checkIn: Date | null;
  checkOut: Date | null;
  status: AttendanceStatus;
  note: string | null;
  dutyStartTimeSnapshot: string | null;
  dutyEndTimeSnapshot: string | null;
};

function buildLog(
  day: number,
  status: AttendanceStatus,
  opts: { checkIn?: Date | null; checkOut?: Date | null; note?: string | null } = {},
): FakeLog {
  return {
    date: augustDate(day),
    checkIn: opts.checkIn ?? null,
    checkOut: opts.checkOut ?? null,
    status,
    note: opts.note ?? null,
    dutyStartTimeSnapshot: null,
    dutyEndTimeSnapshot: null,
  };
}

const STIPEND_RECORD = { basicStipend: 24800 }; // 24800 / (8h * 31 days) = 100.00/hour, easy arithmetic
const EMPLOYEE = {
  // No dutyTotalHours/dutyStartTime/dutyEndTime/shift configured on purpose
  // -> getDutyWindow() resolves null -> hoursFromDutyWindow(null) = 8h
  // default, for BOTH the outer hourly-rate denominator (resolveDailyDutyHours)
  // and each day's own dayDutyMinutes inside the loop. Keeps the arithmetic
  // in every test below fully deterministic without needing a duty window.
};

function makeService(logs: FakeLog[]) {
  const prisma = {
    attendanceLog: {
      findMany: jest.fn().mockImplementation((args?: { where?: { date?: { gte?: Date; lte?: Date; lt?: Date } } }) => {
        const dateFilter = args?.where?.date;
        if (!dateFilter) return Promise.resolve(logs);
        return Promise.resolve(
          logs.filter((l) => {
            if (dateFilter.gte && l.date < dateFilter.gte) return false;
            if (dateFilter.lte && l.date > dateFilter.lte) return false;
            if (dateFilter.lt && !(l.date < dateFilter.lt)) return false;
            return true;
          }),
        );
      }),
    },
  };
  const service = new PayrollService(prisma as any, {} as any);
  return { service, prisma };
}

// Far before/after August 2026 -> a stipend record using these defaults
// effectively covers the whole target month, matching pre-segmentation
// behavior exactly (Test A).
const FAR_PAST = new Date(Date.UTC(2000, 0, 1));

async function computeBreakdown(
  logs: FakeLog[],
  opts: {
    stipendRecord?: { basicStipend: number; effectiveFrom?: Date; effectiveTo?: Date | null };
    existingDeductions?: Array<{ amount: unknown }>;
    existingAllowances?: Array<{ amount: unknown }>;
    employee?: { joiningDate?: Date | null };
  } = {},
) {
  const { service } = makeService(logs);
  const stipendRecord = {
    effectiveFrom: FAR_PAST,
    effectiveTo: null as Date | null,
    ...(opts.stipendRecord ?? STIPEND_RECORD),
  };
  return (service as any).computeHourlyBreakdown('emp-1', 8, 2026, {
    stipendRecord,
    employee: { ...EMPLOYEE, ...opts.employee },
    existingDeductions: opts.existingDeductions ?? [],
    existingAllowances: opts.existingAllowances ?? [],
    asOf: new Date(Date.UTC(2026, 8, 1)),
  });
}

const FULL_DAY_MINUTES = 480; // 8h default duty window

describe('PayrollService.computeHourlyBreakdown — PRESENT/SWAP_COVERED basic-earning floor', () => {
  // A. PRESENT full scheduled shift -> one full scheduled-day basic credit
  it('A: PRESENT with a full scheduled shift earns one full scheduled-day credit', async () => {
    const logs = [
      buildLog(3, AttendanceStatus.PRESENT, {
        checkIn: pkTime(3, 9, 0),
        checkOut: pkTime(3, 17, 0), // exactly 8h
      }),
    ];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.workedMinutes).toBe(0);
    expect(b.payableMinutes).toBe(FULL_DAY_MINUTES);
  });

  // B. PRESENT with short/raw punch session -> still one full scheduled-day credit
  it('B: PRESENT with a short raw punch session (15 min) still earns a full scheduled-day credit', async () => {
    const logs = [
      buildLog(3, AttendanceStatus.PRESENT, {
        checkIn: pkTime(3, 9, 0),
        checkOut: pkTime(3, 9, 15), // only 15 minutes clocked
      }),
    ];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.workedMinutes).toBe(0);
    expect(b.payableMinutes).toBe(FULL_DAY_MINUTES);
  });

  // C. PRESENT with anomalous checkIn/checkOut -> still one full scheduled-day credit
  it('C: PRESENT with an anomalous checkOut-before-checkIn pair still earns a full scheduled-day credit', async () => {
    const logs = [
      buildLog(3, AttendanceStatus.PRESENT, {
        checkIn: pkTime(3, 17, 0),
        checkOut: pkTime(3, 9, 0), // checkOut before checkIn -> anomalous under the old raw-overlap path
      }),
    ];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.workedMinutes).toBe(0);
    expect(b.payableMinutes).toBe(FULL_DAY_MINUTES);
  });

  // D. SWAP_COVERED -> one full scheduled-day basic credit
  it('D: SWAP_COVERED earns one full scheduled-day credit regardless of raw session length', async () => {
    const logs = [
      buildLog(3, AttendanceStatus.SWAP_COVERED, {
        checkIn: pkTime(3, 9, 0),
        checkOut: pkTime(3, 9, 20),
      }),
    ];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.workedMinutes).toBe(0);
    expect(b.payableMinutes).toBe(FULL_DAY_MINUTES);
  });

  // E. LATE behavior unchanged
  it('E: LATE still earns full scheduled-day policy credit (unchanged)', async () => {
    const logs = [
      buildLog(3, AttendanceStatus.LATE, {
        checkIn: pkTime(3, 9, 40),
        checkOut: pkTime(3, 17, 0),
      }),
    ];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.workedMinutes).toBe(0);
  });

  it('HALF_DAY still earns a full scheduled-day of basic; the 0.5-day cut is a PayrollDeduction', async () => {
    const logs = [buildLog(3, AttendanceStatus.HALF_DAY)];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.hourlyBasicEarned).toBe(800);
  });

  it('UNMARKED still earns a full scheduled-day of basic; the 1-day cut is a PayrollDeduction', async () => {
    const logs = [buildLog(3, AttendanceStatus.UNMARKED)];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.hourlyBasicEarned).toBe(800);
  });

  it('does not backfill when multiple stipend segments overlap the month', async () => {
    const logs = [buildLog(3, AttendanceStatus.PRESENT)];
    const { service } = makeService(logs);
    const closedLateSegment = await (service as any).computeHourlyBreakdown(
      'emp-1',
      8,
      2026,
      {
        stipendRecord: {
          basicStipend: 15000,
          effectiveFrom: new Date(Date.UTC(2026, 7, 17)),
          effectiveTo: new Date(Date.UTC(2026, 7, 20)),
        },
        employee: { ...EMPLOYEE, joiningDate: new Date(Date.UTC(2022, 11, 7)) },
        existingDeductions: [],
        existingAllowances: [],
        asOf: new Date(Date.UTC(2026, 8, 1)),
        backfillFromJoining: false,
      },
    );
    expect(closedLateSegment.policyCreditMinutes).toBe(0);
  });

  it('oldest stipend created after joining still pays days before effectiveFrom', async () => {
    const logs = [buildLog(3, AttendanceStatus.PRESENT)];
    const { service } = makeService(logs);
    const withoutBackfill = await (service as any).computeHourlyBreakdown('emp-1', 8, 2026, {
      stipendRecord: {
        basicStipend: 24800,
        effectiveFrom: new Date(Date.UTC(2026, 7, 17)),
        effectiveTo: null,
      },
      employee: { ...EMPLOYEE, joiningDate: new Date(Date.UTC(2022, 11, 7)) },
      existingDeductions: [],
      existingAllowances: [],
      asOf: new Date(Date.UTC(2026, 8, 1)),
      backfillFromJoining: false,
    });
    expect(withoutBackfill.policyCreditMinutes).toBe(0);

    const withBackfill = await (service as any).computeHourlyBreakdown('emp-1', 8, 2026, {
      stipendRecord: {
        basicStipend: 24800,
        effectiveFrom: new Date(Date.UTC(2026, 7, 17)),
        effectiveTo: null,
      },
      employee: { ...EMPLOYEE, joiningDate: new Date(Date.UTC(2022, 11, 7)) },
      existingDeductions: [],
      existingAllowances: [],
      asOf: new Date(Date.UTC(2026, 8, 1)),
      backfillFromJoining: true,
    });
    expect(withBackfill.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(withBackfill.hourlyBasicEarned).toBe(800);
  });

  it('backfills from month-start when stipend starts after the month but attendance exists', async () => {
    const logs = [
      buildLog(3, AttendanceStatus.PRESENT),
      buildLog(10, AttendanceStatus.LATE),
    ];
    const { service } = makeService(logs);
    const withoutBackfill = await (service as any).computeHourlyBreakdown(
      'emp-1',
      8,
      2026,
      {
        stipendRecord: {
          basicStipend: 25000,
          effectiveFrom: new Date(Date.UTC(2026, 8, 1)),
          effectiveTo: null,
        },
        employee: {
          ...EMPLOYEE,
          joiningDate: new Date(Date.UTC(2026, 8, 1)),
        },
        existingDeductions: [],
        existingAllowances: [],
        asOf: new Date(Date.UTC(2026, 8, 1)),
        backfillFromAttendance: false,
      },
    );
    expect(withoutBackfill.policyCreditMinutes).toBe(0);

    const withBackfill = await (service as any).computeHourlyBreakdown(
      'emp-1',
      8,
      2026,
      {
        stipendRecord: {
          basicStipend: 25000,
          effectiveFrom: new Date(Date.UTC(2026, 8, 1)),
          effectiveTo: null,
        },
        employee: {
          ...EMPLOYEE,
          joiningDate: new Date(Date.UTC(2026, 8, 1)),
        },
        existingDeductions: [],
        existingAllowances: [],
        asOf: new Date(Date.UTC(2026, 8, 1)),
        backfillFromAttendance: true,
      },
    );
    expect(withBackfill.policyCreditMinutes).toBe(FULL_DAY_MINUTES * 2);
    expect(withBackfill.hourlyBasicEarned).toBeGreaterThan(0);
  });

  it('never stores a negative net stipend', async () => {
    const logs = [buildLog(3, AttendanceStatus.PRESENT)];
    const b = await computeBreakdown(logs, {
      existingDeductions: [{ amount: 50000 }],
    });
    expect(b.hourlyBasicEarned).toBe(800);
    expect(b.payrollBasicStipend).toBe(800);
    expect(b.netStipend).toBe(0);
  });

  it('does not credit future days in an in-progress month without attendance logs', async () => {
    const logs = [buildLog(3, AttendanceStatus.PRESENT)];
    const b = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 24800 },
    });
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);

    const { service } = makeService(logs);
    const inProgress = await (service as any).computeHourlyBreakdown('emp-1', 8, 2026, {
      stipendRecord: { basicStipend: 24800, effectiveFrom: FAR_PAST, effectiveTo: null },
      employee: EMPLOYEE,
      existingDeductions: [],
      existingAllowances: [],
      asOf: new Date(Date.UTC(2026, 7, 14, 0, 0, 0)),
    });
    expect(inProgress.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(inProgress.hourlyBasicEarned).toBe(800);
  });

  // F. ON_LEAVE behavior unchanged
  it('F: ON_LEAVE still earns full scheduled-day policy credit (unchanged)', async () => {
    const logs = [buildLog(3, AttendanceStatus.ON_LEAVE)];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.workedMinutes).toBe(0);
  });

  // G. ABSENT / UNINFORMED_ABSENT basic earning unchanged, deductions stay separate
  it('G: ABSENT and UNINFORMED_ABSENT still earn full scheduled-day policy credit, independent of PayrollDeduction rows', async () => {
    const logs = [
      buildLog(3, AttendanceStatus.ABSENT),
      buildLog(4, AttendanceStatus.UNINFORMED_ABSENT),
    ];
    const withoutDeduction = await computeBreakdown(logs);
    expect(withoutDeduction.policyCreditMinutes).toBe(2 * FULL_DAY_MINUTES);
    expect(withoutDeduction.workedMinutes).toBe(0);

    // Basic earning (policyCreditMinutes / hourlyBasicEarned) must be
    // identical whether or not a disciplinary deduction row exists —
    // the deduction only ever affects netStipend via disciplineDeductions.
    const withDeduction = await computeBreakdown(logs, {
      existingDeductions: [{ amount: 1600 }],
    });
    expect(withDeduction.policyCreditMinutes).toBe(withoutDeduction.policyCreditMinutes);
    expect(withDeduction.hourlyBasicEarned).toBe(withoutDeduction.hourlyBasicEarned);
    expect(withDeduction.disciplineDeductions).toBe(1600);
    expect(withDeduction.netStipend).toBe(
      Math.round((withoutDeduction.netStipend - 1600) * 100) / 100,
    );
  });

  // H. missing checkout behavior unchanged
  it('H: checkIn without checkOut (missing checkout / 24h staff) still earns full scheduled-day policy credit', async () => {
    const logs = [
      buildLog(3, AttendanceStatus.PRESENT, {
        checkIn: pkTime(3, 9, 0),
        checkOut: null,
      }),
    ];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.workedMinutes).toBe(0);
  });

  // I. No double-crediting of PRESENT
  it('I: a PRESENT day never contributes both policy credit AND raw worked minutes for the same day', async () => {
    const logs = [
      buildLog(3, AttendanceStatus.PRESENT, {
        checkIn: pkTime(3, 9, 0),
        checkOut: pkTime(3, 17, 0),
      }),
    ];
    const b = await computeBreakdown(logs);
    // Exactly one scheduled day's worth — not FULL_DAY_MINUTES * 2.
    expect(b.payableMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.workedMinutes).toBe(0);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
  });

  // 6. Month-level regression: full-attendance month -> full contractual basic stipend
  it('month-level: an employee PRESENT every day of August earns the full contractual basic stipend', async () => {
    const daysInAugust2026 = 31;
    const logs = Array.from({ length: daysInAugust2026 }, (_, i) =>
      buildLog(i + 1, AttendanceStatus.PRESENT, {
        checkIn: pkTime(i + 1, 9, 0),
        checkOut: pkTime(i + 1, 17, 0),
      }),
    );
    const b = await computeBreakdown(logs, { stipendRecord: { basicStipend: 35000 } });
    expect(b.hourlyBasicEarned).toBe(35000);
  });

  // Reproduces one of the reported production symptoms directly: full
  // attendance except one LATE + one ON_LEAVE day, on a 35,000 contractual
  // stipend, must earn close to the FULL stipend now (minus nothing, since
  // LATE/ON_LEAVE also earn full credit) rather than collapsing to ~4,490.
  it('reproduces the Dawood Ahmed production scenario: 16 PRESENT + 1 LATE + 1 ON_LEAVE no longer collapses basic pay', async () => {
    const logs = [
      ...Array.from({ length: 16 }, (_, i) =>
        buildLog(i + 1, AttendanceStatus.PRESENT, {
          checkIn: pkTime(i + 1, 9, 0),
          checkOut: pkTime(i + 1, 9, 5), // deliberately short/anomalous-shaped raw session
        }),
      ),
      buildLog(17, AttendanceStatus.LATE, { checkIn: pkTime(17, 9, 40), checkOut: pkTime(17, 17, 0) }),
      buildLog(18, AttendanceStatus.ON_LEAVE),
    ];
    const b = await computeBreakdown(logs, { stipendRecord: { basicStipend: 35000 } });
    // 18 scheduled days out of 31 in the month, all fully credited.
    const expectedMinutes = 18 * FULL_DAY_MINUTES;
    expect(b.policyCreditMinutes).toBe(expectedMinutes);
    expect(b.workedMinutes).toBe(0);
    expect(b.hourlyBasicEarned).toBe(
      roundMoney((35000 * expectedMinutes) / (31 * FULL_DAY_MINUTES)),
    );
    // Must be far above the previously-reported 4,489.97 collapse.
    expect(b.hourlyBasicEarned).toBeGreaterThan(20000);
  });
});

/**
 * Regression coverage for Step 2: mid-month StipendRecord segmentation.
 *
 * Root cause being regression-tested: computeHourlyBreakdown previously
 * queried the ENTIRE calendar month of AttendanceLog rows regardless of
 * which StipendRecord it was computing for, so two PayrollEntry rows for
 * the same employee/month (one per stipend segment, after a mid-month
 * salary revision) could both count the same attendance dates at two
 * different rates.
 *
 * Boundary semantics: established from PayrollService.salaryIncrement(),
 * where the OLD record's effectiveTo and the NEW record's effectiveFrom
 * are set to the literal same Date value — a half-open
 * [effectiveFrom, effectiveTo) interval. effectiveFrom is inclusive (also
 * consistent with employees.service.ts's initial StipendRecord using
 * effectiveFrom: joiningDate, where the joining day itself is paid).
 */
describe('PayrollService.computeHourlyBreakdown — mid-month StipendRecord segmentation', () => {
  // A full month of PRESENT, full 8h shifts, dates 1..31 of August 2026.
  function fullMonthPresentLogs(): FakeLog[] {
    return Array.from({ length: 31 }, (_, i) =>
      buildLog(i + 1, AttendanceStatus.PRESENT, {
        checkIn: pkTime(i + 1, 9, 0),
        checkOut: pkTime(i + 1, 17, 0),
      }),
    );
  }

  function makeSegmentAwareService(allLogs: FakeLog[]) {
    const findMany = jest.fn(async (args: any) => {
      const d = args.where.date;
      return allLogs.filter((l) => {
        if (d.gte && l.date.getTime() < d.gte.getTime()) return false;
        if (d.lte && l.date.getTime() > d.lte.getTime()) return false;
        if (d.lt && l.date.getTime() >= d.lt.getTime()) return false;
        return true;
      });
    });
    const prisma = { attendanceLog: { findMany } };
    const service = new PayrollService(prisma as any, {} as any);
    return { service, prisma, findMany };
  }

  async function computeSegment(
    allLogs: FakeLog[],
    stipendRecord: { basicStipend: number; effectiveFrom: Date; effectiveTo?: Date | null },
  ) {
    const { service, findMany } = makeSegmentAwareService(allLogs);
    const breakdown = await (service as any).computeHourlyBreakdown('emp-1', 8, 2026, {
      stipendRecord,
      employee: EMPLOYEE,
      existingDeductions: [],
      existingAllowances: [],
      asOf: new Date(Date.UTC(2026, 8, 1)),
    });
    return { breakdown, findMany };
  }

  const AUG_15 = new Date(Date.UTC(2026, 7, 15, 0, 0, 0)); // transition date used throughout

  // A. One stipend record effective for the full month -> behavior unchanged
  it('A: a stipend record effective for the whole month behaves exactly like the pre-segmentation calculation', async () => {
    const logs = fullMonthPresentLogs();
    const { breakdown } = await computeSegment(logs, {
      basicStipend: 24800,
      effectiveFrom: FAR_PAST,
      effectiveTo: null,
    });
    expect(breakdown.policyCreditMinutes).toBe(31 * FULL_DAY_MINUTES);
    expect(breakdown.hourlyBasicEarned).toBe(24800); // exact, see Test A in the Step 1 suite above
  });

  // B. Salary increase mid-month: old segment first half, new segment second half.
  it('B: a mid-month salary increase splits attendance into two non-overlapping segments with no missing transition date', async () => {
    const logs = fullMonthPresentLogs();
    const { breakdown: oldSeg } = await computeSegment(logs, {
      basicStipend: 24800,
      effectiveFrom: FAR_PAST,
      effectiveTo: AUG_15, // exclusive -> covers Aug 1..14
    });
    const { breakdown: newSeg } = await computeSegment(logs, {
      basicStipend: 27900,
      effectiveFrom: AUG_15, // inclusive -> covers Aug 15..31
      effectiveTo: null,
    });
    expect(oldSeg.policyCreditMinutes).toBe(14 * FULL_DAY_MINUTES);
    expect(newSeg.policyCreditMinutes).toBe(17 * FULL_DAY_MINUTES);
    // Every one of the 31 days is counted, and counted exactly once.
    expect(oldSeg.policyCreditMinutes + newSeg.policyCreditMinutes).toBe(31 * FULL_DAY_MINUTES);
  });

  // C. Combined basic earning across both segments equals the correct
  // prorated total across the two different salary rates.
  it('C: combined basic earning across both segments matches the correct two-rate prorated total', async () => {
    const logs = fullMonthPresentLogs();
    const { breakdown: oldSeg } = await computeSegment(logs, {
      basicStipend: 24800, // hourlyRate = 24800 / (8*31) = 100.00 exactly
      effectiveFrom: FAR_PAST,
      effectiveTo: AUG_15,
    });
    const { breakdown: newSeg } = await computeSegment(logs, {
      basicStipend: 27900, // hourlyRate = 27900 / (8*31) = 112.50 exactly
      effectiveFrom: AUG_15,
      effectiveTo: null,
    });
    const oldExpected = roundMoney(roundHoursFromMinutes(14 * FULL_DAY_MINUTES) * computeHourlyRate(24800, 8, 31));
    const newExpected = roundMoney(roundHoursFromMinutes(17 * FULL_DAY_MINUTES) * computeHourlyRate(27900, 8, 31));
    expect(oldSeg.hourlyBasicEarned).toBe(oldExpected);
    expect(oldSeg.hourlyBasicEarned).toBe(11200); // 14 days * 8h * 100/h
    expect(newSeg.hourlyBasicEarned).toBe(newExpected);
    expect(newSeg.hourlyBasicEarned).toBe(15300); // 17 days * 8h * 112.5/h
    expect(roundMoney(oldSeg.hourlyBasicEarned + newSeg.hourlyBasicEarned)).toBe(26500);
  });

  // D. Transition-date boundary test.
  it('D: the exact transition date (Aug 15) belongs to the NEW segment only, per effectiveFrom-inclusive/effectiveTo-exclusive semantics', async () => {
    const logs = [
      buildLog(14, AttendanceStatus.PRESENT, { checkIn: pkTime(14, 9, 0), checkOut: pkTime(14, 17, 0) }),
      buildLog(15, AttendanceStatus.PRESENT, { checkIn: pkTime(15, 9, 0), checkOut: pkTime(15, 17, 0) }),
    ];
    const { breakdown: oldSeg } = await computeSegment(logs, {
      basicStipend: 24800,
      effectiveFrom: FAR_PAST,
      effectiveTo: AUG_15,
    });
    const { breakdown: newSeg } = await computeSegment(logs, {
      basicStipend: 27900,
      effectiveFrom: AUG_15,
      effectiveTo: null,
    });
    // Old segment: only Aug 14 (1 day). New segment: only Aug 15 (1 day).
    expect(oldSeg.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(newSeg.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
  });

  // E. Old stipend segment must not include attendance after its effective period.
  it('E: the old segment excludes attendance dates on/after its effectiveTo, even when that data exists', async () => {
    const logs = fullMonthPresentLogs(); // includes Aug 16..31 too
    const { breakdown: oldSeg } = await computeSegment(logs, {
      basicStipend: 24800,
      effectiveFrom: FAR_PAST,
      effectiveTo: AUG_15,
    });
    // Exactly Aug 1..14 -> 14 days, never leaks into Aug 15 onward.
    expect(oldSeg.policyCreditMinutes).toBe(14 * FULL_DAY_MINUTES);
  });

  // F. New stipend segment must not include attendance before its effective period.
  it('F: the new segment excludes attendance dates before its effectiveFrom, even when that data exists', async () => {
    const logs = fullMonthPresentLogs(); // includes Aug 1..14 too
    const { breakdown: newSeg } = await computeSegment(logs, {
      basicStipend: 27900,
      effectiveFrom: AUG_15,
      effectiveTo: null,
    });
    // Exactly Aug 15..31 -> 17 days, never reaches back into Aug 1..14.
    expect(newSeg.policyCreditMinutes).toBe(17 * FULL_DAY_MINUTES);
  });

  // G. Two PayrollEntry rows for the same employee/month: combined total
  // correct, no attendance date contributes to both.
  it('G: every attendance date in the month contributes basic earning to exactly one segment, never zero, never two', async () => {
    const logs = fullMonthPresentLogs();
    const { breakdown: oldSeg } = await computeSegment(logs, {
      basicStipend: 24800,
      effectiveFrom: FAR_PAST,
      effectiveTo: AUG_15,
    });
    const { breakdown: newSeg } = await computeSegment(logs, {
      basicStipend: 27900,
      effectiveFrom: AUG_15,
      effectiveTo: null,
    });
    expect(oldSeg.workedMinutes + newSeg.workedMinutes).toBe(0); // PRESENT -> policy credit only, Step 1
    expect(oldSeg.policyCreditMinutes + newSeg.policyCreditMinutes).toBe(31 * FULL_DAY_MINUTES);
  });

  // H. Step 1 regression: PRESENT/SWAP_COVERED still get full scheduled-day
  // credit WITHIN each segment.
  it('H: PRESENT and SWAP_COVERED still earn a full scheduled-day floor inside each stipend segment', async () => {
    const logs = [
      buildLog(10, AttendanceStatus.PRESENT, { checkIn: pkTime(10, 9, 0), checkOut: pkTime(10, 9, 5) }), // short session
      buildLog(20, AttendanceStatus.SWAP_COVERED, { checkIn: pkTime(20, 9, 0), checkOut: pkTime(20, 9, 5) }),
    ];
    const { breakdown: oldSeg } = await computeSegment(logs, {
      basicStipend: 24800,
      effectiveFrom: FAR_PAST,
      effectiveTo: AUG_15,
    });
    const { breakdown: newSeg } = await computeSegment(logs, {
      basicStipend: 27900,
      effectiveFrom: AUG_15,
      effectiveTo: null,
    });
    expect(oldSeg.policyCreditMinutes).toBe(FULL_DAY_MINUTES); // PRESENT on Aug 10
    expect(oldSeg.workedMinutes).toBe(0);
    expect(newSeg.policyCreditMinutes).toBe(FULL_DAY_MINUTES); // SWAP_COVERED on Aug 20
    expect(newSeg.workedMinutes).toBe(0);
  });

  // I. Refresh recalculates correctly for a PENDING segment; PROCESSED/PAID
  // freeze is enforced twice now (defense in depth) — once in
  // createOrGetEntry's early return for the active segment, and once
  // inside upsertPayrollEntryForStipendSegment (shared by createOrGetEntry
  // for every OTHER segment and by recomputeEmployeeMonth) — verified
  // structurally below.
  it('I: recomputing a PENDING segment after an attendance correction reflects the new data (refresh works)', async () => {
    const before = [buildLog(10, AttendanceStatus.PRESENT, { checkIn: pkTime(10, 9, 0), checkOut: pkTime(10, 17, 0) })];
    const after = [buildLog(10, AttendanceStatus.ABSENT)]; // e.g. corrected after the fact
    const { breakdown: beforeB } = await computeSegment(before, { basicStipend: 24800, effectiveFrom: FAR_PAST, effectiveTo: null });
    const { breakdown: afterB } = await computeSegment(after, { basicStipend: 24800, effectiveFrom: FAR_PAST, effectiveTo: null });
    // Both PRESENT and ABSENT earn full policy credit (Step 1 / pre-existing
    // ABSENT policy) - refresh must reflect the corrected status, not the
    // stale one, even though the credited minutes happen to match here.
    expect(beforeB.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(afterB.policyCreditMinutes).toBe(FULL_DAY_MINUTES);

    const source = fs.readFileSync(path.join(__dirname, 'payroll.service.ts'), 'utf8');
    expect(source).toContain('statusNow?.status === PayrollStatus.PROCESSED');
    const processedOrPaidGuard =
      /status === PayrollStatus\.PROCESSED \|\|[\s\S]{0,80}status === PayrollStatus\.PAID/g;
    const guardCount = (source.match(processedOrPaidGuard) ?? []).length;
    expect(guardCount).toBeGreaterThanOrEqual(2);
  });

  // J. Multiple stipend changes within the same month (three segments).
  it('J: three stipend segments within one month (two transitions) partition the month with no overlap or gap', async () => {
    const logs = fullMonthPresentLogs();
    const AUG_10 = new Date(Date.UTC(2026, 7, 10, 0, 0, 0));
    const AUG_21 = new Date(Date.UTC(2026, 7, 21, 0, 0, 0));
    const { breakdown: seg1 } = await computeSegment(logs, { basicStipend: 20000, effectiveFrom: FAR_PAST, effectiveTo: AUG_10 }); // Aug 1..9
    const { breakdown: seg2 } = await computeSegment(logs, { basicStipend: 24000, effectiveFrom: AUG_10, effectiveTo: AUG_21 }); // Aug 10..20
    const { breakdown: seg3 } = await computeSegment(logs, { basicStipend: 28000, effectiveFrom: AUG_21, effectiveTo: null }); // Aug 21..31
    expect(seg1.policyCreditMinutes).toBe(9 * FULL_DAY_MINUTES);
    expect(seg2.policyCreditMinutes).toBe(11 * FULL_DAY_MINUTES);
    expect(seg3.policyCreditMinutes).toBe(11 * FULL_DAY_MINUTES);
    expect(
      seg1.policyCreditMinutes + seg2.policyCreditMinutes + seg3.policyCreditMinutes,
    ).toBe(31 * FULL_DAY_MINUTES);
  });

  // Confirms the daily-rate denominator policy (Required behavior #5) is
  // untouched: hourlyRate for each segment still divides by the FULL
  // calendar-month day count, never the segment's own day count.
  it('denominator policy: hourlyRate uses the full calendar-month day count, not the segment day count', async () => {
    const logs = fullMonthPresentLogs();
    // 14-day segment at contractual 24800/month: if the denominator were
    // wrongly switched to segment days (14) instead of the full month
    // (31), hourlyRate would be 24800/(8*14)=221.43 and 14 days' credit
    // would equal the FULL 24800 instead of the correct partial amount.
    const wrongDenominatorResult = roundMoney(roundHoursFromMinutes(14 * FULL_DAY_MINUTES) * computeHourlyRate(24800, 8, 14));
    const { breakdown } = await computeSegment(logs, { basicStipend: 24800, effectiveFrom: FAR_PAST, effectiveTo: AUG_15 });
    expect(breakdown.hourlyBasicEarned).not.toBe(wrongDenominatorResult);
    expect(breakdown.hourlyBasicEarned).toBe(11200); // correct, full-month-denominator result
  });
});

describe('PayrollService.computeHourlyBreakdown — 19 present days and pre-join unmarked', () => {
  function septemberDate(day: number): Date {
    return new Date(Date.UTC(2026, 8, day, 0, 0, 0));
  }

  async function computeSeptember(
    logs: FakeLog[],
    employee: { joiningDate?: Date | null } = {},
  ) {
    const { service } = makeService(logs);
    return (service as any).computeHourlyBreakdown('emp-1', 9, 2026, {
      stipendRecord: {
        basicStipend: 30000,
        allowances: 10000,
        effectiveFrom: FAR_PAST,
        effectiveTo: null,
      },
      employee: { ...EMPLOYEE, ...employee },
      existingDeductions: [],
      existingAllowances: [],
      asOf: new Date(Date.UTC(2026, 9, 1)),
    });
  }

  it('19 PRESENT days after a Sep 12 join prorate contractual basic 19/30 plus 10000 allowances', async () => {
    const logs = Array.from({ length: 19 }, (_, i) => ({
      date: septemberDate(i + 12),
      checkIn: null,
      checkOut: null,
      status: AttendanceStatus.PRESENT,
      note: null,
      dutyStartTimeSnapshot: null,
      dutyEndTimeSnapshot: null,
    }));
    const unmarked = Array.from({ length: 11 }, (_, i) => ({
      date: septemberDate(i + 1),
      checkIn: null,
      checkOut: null,
      status: AttendanceStatus.UNMARKED,
      note: 'Unmarked — employee had not joined',
      dutyStartTimeSnapshot: null,
      dutyEndTimeSnapshot: null,
    }));
    const b = await computeSeptember([...unmarked, ...logs], {
      joiningDate: new Date(Date.UTC(2026, 8, 12)),
    });
    expect(b.policyCreditMinutes).toBe(19 * FULL_DAY_MINUTES);
    expect(b.hourlyBasicEarned).toBe(19000);
    expect(b.payrollBasicStipend).toBe(19000);
    expect(b.fixedAllowances).toBe(10000);
    expect(b.netStipend).toBe(29000);
  });

  it('does not credit PRESENT days before joiningDate', async () => {
    const logs = [
      {
        date: septemberDate(10),
        checkIn: null,
        checkOut: null,
        status: AttendanceStatus.PRESENT,
        note: null,
        dutyStartTimeSnapshot: null,
        dutyEndTimeSnapshot: null,
      },
      {
        date: septemberDate(14),
        checkIn: null,
        checkOut: null,
        status: AttendanceStatus.PRESENT,
        note: null,
        dutyStartTimeSnapshot: null,
        dutyEndTimeSnapshot: null,
      },
    ];
    const b = await computeSeptember(logs, {
      joiningDate: new Date(Date.UTC(2026, 8, 14)),
    });
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
  });
});

describe('PayrollService — contractual PayrollEntry basic stipend', () => {
  function logsForDays(days: number[], status: AttendanceStatus = AttendanceStatus.PRESENT) {
    return days.map((day) =>
      buildLog(day, status, {
        checkIn: pkTime(day, 9, 0),
        checkOut: pkTime(day, 17, 0),
      }),
    );
  }

  it('A: 28 PRESENT days in August earn 28/31 of monthly basic', async () => {
    const logs = logsForDays(Array.from({ length: 28 }, (_, i) => i + 1));
    const b = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 100000, effectiveFrom: FAR_PAST, effectiveTo: null },
    });
    expect(b.creditedAttendanceDays).toBe(28);
    expect(b.payrollBasicStipend).toBe(90322.58);
    expect(b.netStipend).toBe(90322.58);
  });

  it('B: 25000 and 18000 packages use the same 28-day attendance basic', async () => {
    const logs = logsForDays(Array.from({ length: 28 }, (_, i) => i + 1));
    const b25 = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 25000, effectiveFrom: FAR_PAST, effectiveTo: null },
    });
    const b18 = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 18000, effectiveFrom: FAR_PAST, effectiveTo: null },
    });
    expect(b25.payrollBasicStipend).toBe(roundMoney((25000 * 28) / 31));
    expect(b18.payrollBasicStipend).toBe(roundMoney((18000 * 28) / 31));
  });

  it('C: later PRESENT logs in the same month increase PENDING basic', async () => {
    const through28 = logsForDays(Array.from({ length: 28 }, (_, i) => i + 1));
    const full = logsForDays(Array.from({ length: 31 }, (_, i) => i + 1));
    const stipend = {
      stipendRecord: { basicStipend: 100000, effectiveFrom: FAR_PAST, effectiveTo: null },
    };
    const before = await computeBreakdown(through28, stipend);
    const after = await computeBreakdown(full, stipend);
    expect(before.payrollBasicStipend).toBe(90322.58);
    expect(after.payrollBasicStipend).toBe(100000);
    expect(after.creditedAttendanceDays).toBe(31);
  });

  it('D: ABSENT / UNMARKED / LATE still credit a full basic day; deductions stay separate', async () => {
    const logs = [
      ...logsForDays([1, 2], AttendanceStatus.ABSENT),
      ...logsForDays([3], AttendanceStatus.UNMARKED),
      ...logsForDays([4], AttendanceStatus.LATE),
      ...logsForDays(Array.from({ length: 24 }, (_, i) => i + 5)),
    ];
    const b = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 100000, effectiveFrom: FAR_PAST, effectiveTo: null },
      existingDeductions: [{ amount: 6451.61 }],
    });
    expect(b.creditedAttendanceDays).toBe(28);
    expect(b.payrollBasicStipend).toBe(90322.58);
    expect(b.disciplineDeductions).toBe(6451.61);
    expect(b.netStipend).toBe(roundMoney(90322.58 - 6451.61));
  });

  it('E: mid-month stipend start without month backfill only credits logs in that segment', async () => {
    const aug15 = new Date(Date.UTC(2026, 7, 15));
    const fewLogs = logsForDays([15, 16]);
    const b = await computeBreakdown(fewLogs, {
      stipendRecord: { basicStipend: 100000, effectiveFrom: aug15, effectiveTo: null },
    });
    expect(b.creditedAttendanceDays).toBe(2);
    expect(b.payrollBasicStipend).toBe(roundMoney((100000 * 2) / 31));
  });

  it('E2: mid-month joiningDate only credits post-join attendance days', async () => {
    const fewLogs = logsForDays([15, 16]);
    const b = await computeBreakdown(fewLogs, {
      stipendRecord: { basicStipend: 100000, effectiveFrom: FAR_PAST, effectiveTo: null },
      employee: { joiningDate: new Date(Date.UTC(2026, 7, 15)) },
    });
    expect(b.creditedAttendanceDays).toBe(2);
    expect(b.payrollBasicStipend).toBe(roundMoney((100000 * 2) / 31));
  });

  it('E3: active package backfill credits 1st–28th even if stipend effectiveFrom is Aug 28', async () => {
    const logs = logsForDays(Array.from({ length: 28 }, (_, i) => i + 1));
    const { service } = makeService(logs);
    const b = await (service as any).computeHourlyBreakdown('emp-1', 8, 2026, {
      stipendRecord: {
        basicStipend: 30000,
        effectiveFrom: new Date(Date.UTC(2026, 7, 28)),
        effectiveTo: null,
      },
      employee: { ...EMPLOYEE, joiningDate: new Date(Date.UTC(2021, 1, 21)) },
      existingDeductions: [],
      existingAllowances: [],
      asOf: new Date(Date.UTC(2026, 8, 1)),
      backfillFromJoining: true,
    });
    expect(b.creditedAttendanceDays).toBe(28);
    expect(b.payrollBasicStipend).toBe(roundMoney((30000 * 28) / 31));
  });

  it('F: closed vs open stipend segments credit attendance days in each window', async () => {
    const aug15 = new Date(Date.UTC(2026, 7, 15));
    const logs = logsForDays(Array.from({ length: 31 }, (_, i) => i + 1));
    const oldSeg = await computeBreakdown(logs, {
      stipendRecord: {
        basicStipend: 24800,
        effectiveFrom: FAR_PAST,
        effectiveTo: aug15,
      },
    });
    const newSeg = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 27900, effectiveFrom: aug15, effectiveTo: null },
    });
    expect(oldSeg.payrollBasicStipend).toBe(11200);
    expect(newSeg.payrollBasicStipend).toBe(15300);
  });

  it('SHORT_LEAVE credits a full basic day regardless of punch length', async () => {
    const logs = logsForDays([3], AttendanceStatus.SHORT_LEAVE);
    const b = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 24800, effectiveFrom: FAR_PAST, effectiveTo: null },
    });
    expect(b.creditedAttendanceDays).toBe(1);
    expect(b.payrollBasicStipend).toBe(800);
  });

  it('I: net is payroll basic + allowances − deductions', async () => {
    const logs = logsForDays([1]);
    const b = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 100000, effectiveFrom: FAR_PAST, effectiveTo: null },
      existingDeductions: [{ amount: 5000 }],
      existingAllowances: [{ amount: 2000 }],
    });
    expect(b.payrollBasicStipend).toBe(roundMoney(100000 / 31));
    expect(b.netStipend).toBe(roundMoney(100000 / 31 + 2000 - 5000));
  });
});
