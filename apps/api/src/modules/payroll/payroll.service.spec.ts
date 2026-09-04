import * as fs from 'fs';
import * as path from 'path';
import { AttendanceStatus, PayrollStatus } from '@prisma/client';
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
    // 2026-09-04 day-based rewrite: the other 30 unlogged August days are
    // true gap days (elapsed, in-employment, no log at all) and are now
    // credited too, capping Basic at the full contractual amount.
    expect(b.hourlyBasicEarned).toBe(24800);
  });

  it('UNMARKED still earns a full scheduled-day of basic; the 1-day cut is a PayrollDeduction', async () => {
    const logs = [buildLog(3, AttendanceStatus.UNMARKED)];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.hourlyBasicEarned).toBe(24800);
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
    // 2026-09-04 day-based rewrite: the rest of August is gap-filled
    // (elapsed, employed since 2022, no log), capping Basic at full.
    expect(withBackfill.hourlyBasicEarned).toBe(24800);
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
    // 2026-09-04 day-based rewrite: the rest of the month gap-fills to the
    // full contractual amount (capped); a large enough deduction still
    // floors Net at 0.
    expect(b.hourlyBasicEarned).toBe(24800);
    expect(b.payrollBasicStipend).toBe(24800);
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
    // 2026-09-04 day-based rewrite: as-of Aug 14, days 1-13 have elapsed
    // (13 payable days: the logged PRESENT day 3 plus 12 gap-filled days);
    // day 14 onward has not happened yet and contributes nothing — Basic
    // must NOT reach the full 24800 this early in the month.
    expect(inProgress.hourlyBasicEarned).toBe(roundMoney((24800 * 13) / 31));
    expect(inProgress.hourlyBasicEarned).toBeLessThan(24800);
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
    // 18 scheduled days out of 31 in the month, all fully credited from
    // logged statuses.
    const expectedMinutes = 18 * FULL_DAY_MINUTES;
    expect(b.policyCreditMinutes).toBe(expectedMinutes);
    expect(b.workedMinutes).toBe(0);
    // 2026-09-04 day-based rewrite: the remaining 13 August days (19-31)
    // have no log at all and are elapsed as of the default asOf (Sep 1),
    // so they gap-fill too — Basic reaches the full contractual amount,
    // capped, far above both the old 4,489.97 collapse and the older
    // partial-credit figure this test previously asserted.
    expect(b.hourlyBasicEarned).toBe(35000);
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
      // Mirror real production wiring (createOrGetEntry/recomputeEmployeeMonth,
      // payroll.service.ts ~line 1361 and its upsertPayrollEntryForStipendSegment
      // callers ~line 259/398): only the currently-open (effectiveTo === null)
      // segment is "the active package" for Basic/allowances, AND production
      // always widens that active segment's attendance window to month-start
      // (backfillFromJoining) so a mid-month raise pays the new rate for the
      // WHOLE month rather than blending with the closed segment's rate.
      applyContractualPackage: stipendRecord.effectiveTo == null,
      backfillFromJoining: stipendRecord.effectiveTo == null,
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

  // B. Salary increase mid-month (2026-09-04 rule): the closed old segment
  // still only reads its own narrow window (Aug 1-14), but the new active
  // segment now reads the WHOLE month (widened via backfillFromJoining,
  // matching real production wiring) — no blending, the new rate governs
  // every day of the month, not just the days after the raise.
  it('B: a mid-month salary increase widens the new active segment to the whole month; the closed old segment stays narrow', async () => {
    const logs = fullMonthPresentLogs();
    const { breakdown: oldSeg } = await computeSegment(logs, {
      basicStipend: 24800,
      effectiveFrom: FAR_PAST,
      effectiveTo: AUG_15, // exclusive -> still only reads Aug 1..14
    });
    const { breakdown: newSeg } = await computeSegment(logs, {
      basicStipend: 27900,
      effectiveFrom: AUG_15,
      effectiveTo: null,
    });
    expect(oldSeg.policyCreditMinutes).toBe(14 * FULL_DAY_MINUTES);
    // Widened to the whole month, not just Aug 15-31.
    expect(newSeg.policyCreditMinutes).toBe(31 * FULL_DAY_MINUTES);
  });

  // C. A mid-month salary increase: the closed old package earns 0 Basic
  // (no blending, no dual-paid segments) and the new active package earns
  // the full contractual amount for the whole month (2026-09-04 rule).
  it('C: a mid-month salary increase pays the new rate for the whole month, not a two-rate blend', async () => {
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
    expect(oldSeg.hourlyBasicEarned).toBe(0);
    expect(newSeg.hourlyBasicEarned).toBe(27900);
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
    // Old (closed) segment: only Aug 14 (1 day) — unaffected by widening.
    // New (active) segment: 2026-09-04 rule widens it to the whole month,
    // so it also picks up the Aug 14 log even though its own effectiveFrom
    // is Aug 15 — by design, no dates are excluded from the active package.
    expect(oldSeg.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(newSeg.policyCreditMinutes).toBe(2 * FULL_DAY_MINUTES);
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

  // F. 2026-09-04 rule: the ACTIVE new segment is deliberately widened to
  // the whole month (it is "the new rate applies from the 1st", not a
  // narrow window) — it now DOES reach back into Aug 1-14, unlike before.
  it('F: the active new segment is widened to the whole month, reaching back before its own effectiveFrom', async () => {
    const logs = fullMonthPresentLogs(); // includes Aug 1..14 too
    const { breakdown: newSeg } = await computeSegment(logs, {
      basicStipend: 27900,
      effectiveFrom: AUG_15,
      effectiveTo: null,
    });
    expect(newSeg.policyCreditMinutes).toBe(31 * FULL_DAY_MINUTES);
  });

  // G. 2026-09-04 rule: the closed old segment stays narrow and earns 0
  // Basic; the active new segment alone accounts for the whole month — the
  // two segments' raw attendance windows now deliberately overlap (the old
  // one's overlap is financially inert since its Basic is zeroed), so this
  // is no longer a strict one-day-one-segment partition.
  it('G: the closed segment stays narrow (and earns 0 Basic); the active segment alone spans the whole month', async () => {
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
    expect(oldSeg.policyCreditMinutes).toBe(14 * FULL_DAY_MINUTES);
    expect(newSeg.policyCreditMinutes).toBe(31 * FULL_DAY_MINUTES);
    expect(oldSeg.hourlyBasicEarned).toBe(0);
    expect(newSeg.hourlyBasicEarned).toBe(27900);
  });

  // H. Step 1 regression: PRESENT/SWAP_COVERED still get full scheduled-day
  // credit. 2026-09-04: the active new segment's widened window also picks
  // up the old segment's PRESENT day (Aug 10), in addition to its own
  // SWAP_COVERED day (Aug 20) — two full-day credits, not one.
  it('H: PRESENT and SWAP_COVERED still earn a full scheduled-day floor; the active segment sees both days once widened', async () => {
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
    expect(newSeg.policyCreditMinutes).toBe(2 * FULL_DAY_MINUTES); // Aug 10 (widened) + Aug 20
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

  // J. Multiple stipend changes within the same month (three segments,
  // two transitions). 2026-09-04 rule: only the LAST (active, effectiveTo
  // null) segment is widened to the whole month and earns Basic; the two
  // closed segments keep their own narrow windows but earn 0 Basic.
  it('J: with two transitions, only the final active segment is widened and earns Basic', async () => {
    const logs = fullMonthPresentLogs();
    const AUG_10 = new Date(Date.UTC(2026, 7, 10, 0, 0, 0));
    const AUG_21 = new Date(Date.UTC(2026, 7, 21, 0, 0, 0));
    const { breakdown: seg1 } = await computeSegment(logs, { basicStipend: 20000, effectiveFrom: FAR_PAST, effectiveTo: AUG_10 }); // Aug 1..9
    const { breakdown: seg2 } = await computeSegment(logs, { basicStipend: 24000, effectiveFrom: AUG_10, effectiveTo: AUG_21 }); // Aug 10..20
    const { breakdown: seg3 } = await computeSegment(logs, { basicStipend: 28000, effectiveFrom: AUG_21, effectiveTo: null }); // Aug 21..31, widened to Aug 1..31
    expect(seg1.policyCreditMinutes).toBe(9 * FULL_DAY_MINUTES);
    expect(seg2.policyCreditMinutes).toBe(11 * FULL_DAY_MINUTES);
    expect(seg3.policyCreditMinutes).toBe(31 * FULL_DAY_MINUTES);
    expect(seg1.hourlyBasicEarned).toBe(0);
    expect(seg2.hourlyBasicEarned).toBe(0);
    expect(seg3.hourlyBasicEarned).toBe(28000);
  });

  // Confirms the daily-rate denominator policy (Required behavior #5) is
  // untouched: hourlyRate divides by the FULL calendar-month day count,
  // never a shorter window's day count. Checked directly against the raw
  // function (bypassing computeSegment's active-package auto-widening) so
  // this isolates the denominator arithmetic from the 2026-09-04 widening
  // rule tested elsewhere (B/C/F/G/H/J above).
  it('denominator policy: hourlyRate uses the full calendar-month day count, not the segment day count', async () => {
    const logs = fullMonthPresentLogs();
    const { service } = makeSegmentAwareService(logs);
    // 14-day window at contractual 24800/month: if the denominator were
    // wrongly switched to segment days (14) instead of the full month
    // (31), hourlyRate would be 24800/(8*14)=221.43 and 14 days' credit
    // would equal the FULL 24800 instead of the correct partial amount.
    const wrongDenominatorResult = roundMoney(roundHoursFromMinutes(14 * FULL_DAY_MINUTES) * computeHourlyRate(24800, 8, 14));
    const breakdown = await (service as any).computeHourlyBreakdown('emp-1', 8, 2026, {
      stipendRecord: { basicStipend: 24800, effectiveFrom: FAR_PAST, effectiveTo: AUG_15 },
      employee: EMPLOYEE,
      existingDeductions: [],
      existingAllowances: [],
      asOf: new Date(Date.UTC(2026, 8, 1)),
      applyContractualPackage: true, // isolate the denominator, not the 2026-09-04 zero-closed-segment rule
    });
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
    // Final policy: Basic = calendar days from joining (Sep 12–30 = 19/30), not attendance count.
    expect(b.payrollBasicStipend).toBe(19000);
    expect(b.fixedAllowances).toBe(roundMoney((10000 * 19) / 30));
    expect(b.netStipend).toBe(roundMoney(19000 + (10000 * 19) / 30));
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

  it('A: full-month open segment earns full contractual Basic once the whole month is accounted for (logged + gap-filled days)', async () => {
    const logs = logsForDays(Array.from({ length: 28 }, (_, i) => i + 1));
    const b = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 100000, effectiveFrom: FAR_PAST, effectiveTo: null },
    });
    // 2026-09-04 day-based rewrite: 28 logged PRESENT days + 3 gap-filled
    // (elapsed, in-employment, unlogged) August days = 31/31, capped at the
    // full contractual amount — not a fraction of logged days only.
    expect(b.creditedAttendanceDays).toBe(31);
    expect(b.payrollBasicStipend).toBe(100000);
    expect(b.netStipend).toBe(100000);
  });

  it('B: different packages all reach the same full-month cap once gap-filled', async () => {
    const logs = logsForDays(Array.from({ length: 28 }, (_, i) => i + 1));
    const b25 = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 25000, effectiveFrom: FAR_PAST, effectiveTo: null },
    });
    const b18 = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 18000, effectiveFrom: FAR_PAST, effectiveTo: null },
    });
    expect(b25.payrollBasicStipend).toBe(25000);
    expect(b18.payrollBasicStipend).toBe(18000);
  });

  it('C: a full-month segment reaches the same capped Basic whether or not every day is individually logged', async () => {
    const through28 = logsForDays(Array.from({ length: 28 }, (_, i) => i + 1));
    const full = logsForDays(Array.from({ length: 31 }, (_, i) => i + 1));
    const stipend = {
      stipendRecord: { basicStipend: 100000, effectiveFrom: FAR_PAST, effectiveTo: null },
    };
    const before = await computeBreakdown(through28, stipend);
    const after = await computeBreakdown(full, stipend);
    // Both reach the same capped 100000 — 28 logged + 3 gap-filled equals
    // 31 fully logged, by design (a gap day earns exactly what a logged
    // PRESENT day would have).
    expect(before.payrollBasicStipend).toBe(100000);
    expect(after.payrollBasicStipend).toBe(100000);
    expect(before.creditedAttendanceDays).toBe(31);
    expect(after.creditedAttendanceDays).toBe(31);
  });

  it('D: ABSENT / UNMARKED / LATE still earn policy-credit hours; deductions stay separate', async () => {
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
    // 2026-09-04 day-based rewrite: the 3 unlogged trailing August days
    // gap-fill too, reaching the full 31/31 cap; the ABSENT/UNMARKED/LATE
    // days still count as payable (their penalty is the separate
    // disciplineDeductions line, unaffected by this).
    expect(b.creditedAttendanceDays).toBe(31);
    const expectedBasic = 100000;
    expect(b.payrollBasicStipend).toBe(expectedBasic);
    expect(b.disciplineDeductions).toBe(6451.61);
    expect(b.netStipend).toBe(roundMoney(expectedBasic - 6451.61));
  });

  it('E: mid-month stipend start — the segment window (not just logged days) is gap-filled and prorated by calendar days', async () => {
    const aug15 = new Date(Date.UTC(2026, 7, 15));
    const fewLogs = logsForDays([15, 16]);
    const b = await computeBreakdown(fewLogs, {
      stipendRecord: { basicStipend: 100000, effectiveFrom: aug15, effectiveTo: null },
    });
    // 2026-09-04 day-based rewrite: the segment only spans Aug 15-31 (17
    // days); 2 are logged PRESENT and the other 15 gap-fill (elapsed,
    // no log) — all 17 elapsed segment days count, not just the 2 logged.
    expect(b.creditedAttendanceDays).toBe(17);
    expect(b.payrollBasicStipend).toBe(roundMoney((100000 * 17) / 31));
  });

  it('E2: mid-month joiningDate — the post-joining window is gap-filled and prorated by calendar days', async () => {
    const fewLogs = logsForDays([15, 16]);
    const b = await computeBreakdown(fewLogs, {
      stipendRecord: { basicStipend: 100000, effectiveFrom: FAR_PAST, effectiveTo: null },
      employee: { joiningDate: new Date(Date.UTC(2026, 7, 15)) },
    });
    expect(b.creditedAttendanceDays).toBe(17);
    expect(b.payrollBasicStipend).toBe(roundMoney((100000 * 17) / 31));
  });

  it('E3: backfilled attendance earns Basic hourly across all logged days, regardless of package effectiveFrom', async () => {
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
    // 2026-09-04 day-based rewrite: with backfill, attendance is read from
    // joiningDate (bounded to the whole month here), so the 3 unlogged
    // trailing days gap-fill too — full 31/31, capped at contractual.
    expect(b.creditedAttendanceDays).toBe(31);
    expect(b.payrollBasicStipend).toBe(30000);
  });

  it('E4: oldest open package with attendance backfill earns Basic hourly too', async () => {
    const logs = logsForDays(Array.from({ length: 28 }, (_, i) => i + 1));
    const { service } = makeService(logs);
    const b = await (service as any).computeHourlyBreakdown('emp-1', 8, 2026, {
      stipendRecord: {
        basicStipend: 30000,
        allowances: 5000,
        effectiveFrom: new Date(Date.UTC(2026, 7, 28)),
        effectiveTo: null,
      },
      employee: { ...EMPLOYEE, joiningDate: new Date(Date.UTC(2021, 1, 21)) },
      existingDeductions: [],
      existingAllowances: [],
      asOf: new Date(Date.UTC(2026, 8, 1)),
      backfillFromJoining: true,
      backfillContractualFromEmployment: true,
    });
    // Allowances still follow the calendar-month fixed-package rule (rule 11).
    // 2026-09-04 day-based rewrite: Basic gap-fills to the full month (31/31),
    // capped at contractual, same as the sibling backfill test above.
    expect(b.payrollBasicStipend).toBe(30000);
    expect(b.fixedAllowances).toBe(5000);
  });

  it('fixed allowances are the full monthly package on the active salary; Basic is hourly-earned within the package window', async () => {
    const logs = logsForDays(Array.from({ length: 28 }, (_, i) => i + 1));
    const { service } = makeService(logs);
    const b = await (service as any).computeHourlyBreakdown('emp-1', 8, 2026, {
      stipendRecord: {
        basicStipend: 30000,
        allowances: 5000,
        effectiveFrom: new Date(Date.UTC(2026, 7, 28)),
        effectiveTo: null,
      },
      employee: { ...EMPLOYEE, joiningDate: new Date(Date.UTC(2021, 1, 21)) },
      existingDeductions: [],
      existingAllowances: [],
      applyContractualPackage: true,
      asOf: new Date(Date.UTC(2026, 8, 1)),
    });
    expect(b.hourlyRate).toBe(computeHourlyRate(30000, 8, 31));
    expect(b.hourlyRate).not.toBe(computeHourlyRate(35000, 8, 31));
    // Without backfill, attendance is bounded to the package's own window
    // (Aug 28-31, 4 days). 2026-09-04 day-based rewrite: day 28 is logged
    // PRESENT and days 29-31 gap-fill (elapsed, no log) — all 4 segment
    // days count, prorated against the full month.
    expect(b.payrollBasicStipend).toBe(roundMoney((30000 * 4) / 31));
    expect(b.fixedAllowances).toBe(5000);
  });

  it('closed increment segment does not carry the current allowance package', async () => {
    const logs = logsForDays(Array.from({ length: 28 }, (_, i) => i + 1));
    const { service } = makeService(logs);
    const b = await (service as any).computeHourlyBreakdown('emp-1', 8, 2026, {
      stipendRecord: {
        basicStipend: 30000,
        allowances: 5000,
        effectiveFrom: FAR_PAST,
        effectiveTo: new Date(Date.UTC(2026, 7, 28)),
      },
      employee: { ...EMPLOYEE, joiningDate: new Date(Date.UTC(2021, 1, 21)) },
      existingDeductions: [],
      existingAllowances: [],
      applyContractualPackage: false,
      asOf: new Date(Date.UTC(2026, 8, 1)),
    });
    expect(b.fixedAllowances).toBe(0);
  });

  it('history sums a closed prior package with the current open segment', () => {
    const { service } = makeService([]);
    const merged = (service as any).aggregatePayrollHistoryByMonth([
      {
        id: 'new-aug',
        month: 8,
        year: 2026,
        basicStipend: 3870.97,
        totalAllowances: 677.42,
        totalDeductions: 0,
        netStipend: 4548.39,
        status: PayrollStatus.PENDING,
        stipendRecord: {
          effectiveFrom: new Date(Date.UTC(2026, 7, 28)),
          effectiveTo: null,
        },
        deductions: [],
        allowances: [],
      },
      {
        id: 'old-aug',
        month: 8,
        year: 2026,
        basicStipend: 26129.03,
        totalAllowances: 4354.84,
        totalDeductions: 0,
        netStipend: 30483.87,
        status: PayrollStatus.PENDING,
        stipendRecord: {
          effectiveFrom: new Date(Date.UTC(2021, 1, 21)),
          effectiveTo: new Date(Date.UTC(2026, 7, 28)),
        },
        deductions: [],
        allowances: [],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].basicStipend).toBe(30000);
    expect(merged[0].netStipend).toBe(35032.26);
  });

  it('F: closed vs open stipend segments prorate Basic by each contractual window', async () => {
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
    expect(oldSeg.payrollBasicStipend).toBe(11200); // 14/31 * 24800
    expect(newSeg.payrollBasicStipend).toBe(15300); // 17/31 * 27900
  });

  it('SHORT_LEAVE is a full-day-paid, quota-limited status (does not itself reduce Basic)', async () => {
    const logs = logsForDays([3], AttendanceStatus.SHORT_LEAVE);
    const b = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 24800, effectiveFrom: FAR_PAST, effectiveTo: null },
    });
    // 2026-09-04 day-based rewrite: day 3 is logged SHORT_LEAVE (full-day
    // credit, quota-limited — not a pay cut) and the other 30 August days
    // gap-fill (elapsed, no log) — full month, capped at contractual.
    expect(b.creditedAttendanceDays).toBe(31);
    expect(b.payrollBasicStipend).toBe(24800);
  });

  it('I: net is payroll basic + allowances − deductions', async () => {
    const logs = logsForDays([1]);
    const b = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 100000, effectiveFrom: FAR_PAST, effectiveTo: null },
      existingDeductions: [{ amount: 5000 }],
      existingAllowances: [{ amount: 2000 }],
    });
    // 2026-09-04 day-based rewrite: 1 logged day + 30 gap-filled elapsed
    // days = full month, capped at the full contractual Basic.
    const expectedBasic = 100000;
    expect(b.payrollBasicStipend).toBe(expectedBasic);
    expect(b.netStipend).toBe(roundMoney(expectedBasic + 2000 - 5000));
  });
});
