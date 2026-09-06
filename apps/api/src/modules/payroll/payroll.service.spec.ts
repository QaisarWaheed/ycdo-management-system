/** Salary service regressions for canonical stored Card values. Arithmetic tests may use partial Cards; generation completeness is covered in payroll.card-salary.spec.ts. */
import * as fs from 'fs';
import * as path from 'path';
import { AttendanceStatus, PayrollStatus } from '@prisma/client';
import { PayrollService } from './payroll.service';
import { computeHourlyRate, roundMoney } from './payroll-hours.util';

jest.mock('../attendance/discipline.helper', () => ({
  repairLateDisciplineForPayrollMonth: jest.fn().mockResolvedValue({
    applied: 0,
    repaired: 0,
    skipped: 0,
  }),
}));

function pkTime(day: number, hours: number, minutes = 0): Date {
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

const STIPEND_RECORD = { basicStipend: 24800 };
const EMPLOYEE = {
};

function makeService(logs: FakeLog[]) {
  const prisma = {
    employee: { findUnique: jest.fn().mockResolvedValue({monthlyAllowedLeaves: 2}) },
    additionalWorkingDay: {findMany: jest.fn().mockResolvedValue([])},
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
          }).map(log => ({...log, overtimeMinutes: 0, lateMinutes: 0})),
        );
      }),
    },
  };
  const service = new PayrollService(prisma as any, {} as any);
  return { service, prisma };
}
const FAR_PAST = new Date(Date.UTC(2000, 0, 1));

async function computeBreakdown(
  logs: FakeLog[],
  opts: {
    stipendRecord?: { basicStipend: number; effectiveFrom?: Date; effectiveTo?: Date | null };
    existingDeductions?: Array<{ amount: unknown; reason?: string }>;
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

const FULL_DAY_MINUTES = 480;

describe('PayrollService.computeHourlyBreakdown — Attendance Card status credits', () => {
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

  it('HALF_DAY earns half a day directly from the Card', async () => {
    const logs = [buildLog(3, AttendanceStatus.HALF_DAY)];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES / 2);
    expect(b.hourlyBasicEarned).toBe(400);
  });

  it('UNMARKED earns nothing and has no extra attendance penalty', async () => {
    const logs = [buildLog(3, AttendanceStatus.UNMARKED)];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(0);
    expect(b.hourlyBasicEarned).toBe(0);
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

  it('active package credits stored Card dates independently of old backfill flags', async () => {
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
    expect(withoutBackfill.policyCreditMinutes).toBe(FULL_DAY_MINUTES);

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

  it('Card arithmetic uses stored statuses independently of package backfill flags', async () => {
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
    expect(withoutBackfill.policyCreditMinutes).toBe(FULL_DAY_MINUTES * 2);

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
    expect(inProgress.hourlyBasicEarned).toBeLessThan(24800);
  });
  it('F: ON_LEAVE within quota earns one full day through paid-leave credit', async () => {
    const logs = [buildLog(3, AttendanceStatus.ON_LEAVE)];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(0);
    expect(b.paidLeaveMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.workedMinutes).toBe(0);
  });
  it('G: ABSENT and UNINFORMED_ABSENT earn zero with one extra day-rate penalty each', async () => {
    const logs = [
      buildLog(3, AttendanceStatus.ABSENT),
      buildLog(4, AttendanceStatus.UNINFORMED_ABSENT),
    ];
    const withoutDeduction = await computeBreakdown(logs);
    expect(withoutDeduction.policyCreditMinutes).toBe(0);
    expect(withoutDeduction.workedMinutes).toBe(0);
    expect(withoutDeduction.disciplineDeductions).toBe(1600);
    expect(withoutDeduction.payrollBasicStipend).toBe(0);
    const withDeduction = await computeBreakdown(logs, {
      existingDeductions: [{ amount: 1600 }],
    });
    expect(withDeduction.policyCreditMinutes).toBe(withoutDeduction.policyCreditMinutes);
    expect(withDeduction.hourlyBasicEarned).toBe(withoutDeduction.hourlyBasicEarned);
    expect(withDeduction.disciplineDeductions).toBe(3200);
    expect(withDeduction.netStipend).toBe(
      Math.max(0, Math.round((withoutDeduction.netStipend - 1600) * 100) / 100),
    );
  });
  it('H: checkIn without checkOut (missing checkout / 24h staff) still earns full scheduled-day policy credit', async () => {
    const logs = [
      buildLog(3, AttendanceStatus.PRESENT, {
        checkIn: pkTime(3, 9, 0),
        checkOut: null,
      }),
    ];
    const b = await computeBreakdown(logs);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.paidLeaveMinutes).toBe(0);
    expect(b.workedMinutes).toBe(0);
  });
  it('I: a PRESENT day never contributes both policy credit AND raw worked minutes for the same day', async () => {
    const logs = [
      buildLog(3, AttendanceStatus.PRESENT, {
        checkIn: pkTime(3, 9, 0),
        checkOut: pkTime(3, 17, 0),
      }),
    ];
    const b = await computeBreakdown(logs);
    expect(b.payableMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.workedMinutes).toBe(0);
    expect(b.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(b.paidLeaveMinutes).toBe(0);
  });
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
  it('16 PRESENT + 1 LATE + 1 paid ON_LEAVE earn exactly 18 days without inferred gaps', async () => {
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
    const expectedMinutes = 17 * FULL_DAY_MINUTES;
    expect(b.policyCreditMinutes).toBe(expectedMinutes);
    expect(b.workedMinutes).toBe(0);
    expect(b.hourlyBasicEarned).toBe(roundMoney(35000 * 18 / 31));
    expect(b.hourlyBasicEarned).toBeGreaterThan(20000);
  });
});

describe('PayrollService.computeHourlyBreakdown — mid-month StipendRecord segmentation', () => {
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
      }).map(log => ({ ...log, overtimeMinutes: 0, lateMinutes: 0 }));
    });
    const prisma = { employee: { findUnique: jest.fn().mockResolvedValue({ monthlyAllowedLeaves: 2 }) }, additionalWorkingDay: { findMany: jest.fn().mockResolvedValue([]) }, attendanceLog: { findMany } };
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
      applyContractualPackage: stipendRecord.effectiveTo == null,
      backfillFromJoining: stipendRecord.effectiveTo == null,
    });
    return { breakdown, findMany };
  }

  const AUG_15 = new Date(Date.UTC(2026, 7, 15, 0, 0, 0));
  it('A: a stipend record effective for the whole month behaves exactly like the pre-segmentation calculation', async () => {
    const logs = fullMonthPresentLogs();
    const { breakdown } = await computeSegment(logs, {
      basicStipend: 24800,
      effectiveFrom: FAR_PAST,
      effectiveTo: null,
    });
    expect(breakdown.policyCreditMinutes).toBe(31 * FULL_DAY_MINUTES);
    expect(breakdown.hourlyBasicEarned).toBe(24800);
  });
  it('B: only the active package owns Card attendance credit after a salary increase', async () => {
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
    expect(oldSeg.policyCreditMinutes).toBe(0);
    expect(newSeg.policyCreditMinutes).toBe(31 * FULL_DAY_MINUTES);
  });
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
  it('D: stored dates on both sides of the transition belong to the active package once', async () => {
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
    expect(oldSeg.policyCreditMinutes).toBe(0);
    expect(newSeg.policyCreditMinutes).toBe(2 * FULL_DAY_MINUTES);
  });
  it('E: a non-owner closed segment never earns Card attendance credit', async () => {
    const logs = fullMonthPresentLogs();
    const { breakdown: oldSeg } = await computeSegment(logs, {
      basicStipend: 24800,
      effectiveFrom: FAR_PAST,
      effectiveTo: AUG_15,
    });
    expect(oldSeg.policyCreditMinutes).toBe(0);
  });
  it('F: the active new segment is widened to the whole month, reaching back before its own effectiveFrom', async () => {
    const logs = fullMonthPresentLogs();
    const { breakdown: newSeg } = await computeSegment(logs, {
      basicStipend: 27900,
      effectiveFrom: AUG_15,
      effectiveTo: null,
    });
    expect(newSeg.policyCreditMinutes).toBe(31 * FULL_DAY_MINUTES);
  });
  it('G: two segments together earn the monthly Card exactly once', async () => {
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
    expect(oldSeg.workedMinutes + newSeg.workedMinutes).toBe(0);
    expect(oldSeg.policyCreditMinutes).toBe(0);
    expect(newSeg.policyCreditMinutes).toBe(31 * FULL_DAY_MINUTES);
    expect(oldSeg.hourlyBasicEarned).toBe(0);
    expect(newSeg.hourlyBasicEarned).toBe(27900);
  });
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
    expect(oldSeg.policyCreditMinutes).toBe(0);
    expect(oldSeg.workedMinutes).toBe(0);
    expect(newSeg.policyCreditMinutes).toBe(2 * FULL_DAY_MINUTES);
    expect(newSeg.workedMinutes).toBe(0);
  });
  it('I: recomputing a PENDING segment after an attendance correction reflects the new data (refresh works)', async () => {
    const before = [buildLog(10, AttendanceStatus.PRESENT, { checkIn: pkTime(10, 9, 0), checkOut: pkTime(10, 17, 0) })];
    const after = [buildLog(10, AttendanceStatus.ABSENT)];
    const { breakdown: beforeB } = await computeSegment(before, { basicStipend: 24800, effectiveFrom: FAR_PAST, effectiveTo: null });
    const { breakdown: afterB } = await computeSegment(after, { basicStipend: 24800, effectiveFrom: FAR_PAST, effectiveTo: null });
    expect(beforeB.policyCreditMinutes).toBe(FULL_DAY_MINUTES);
    expect(afterB.policyCreditMinutes).toBe(0);

    const source = fs.readFileSync(path.join(__dirname, 'payroll.service.ts'), 'utf8');
    expect(source).toMatch(/if\s*\(entry && entry.status !== PayrollStatus\.PENDING\)\s*return entry;/);
    const processedOrPaidGuard =
      /status === PayrollStatus\.PROCESSED \|\|[\s\S]{0,80}status === PayrollStatus\.PAID/g;
    const guardCount = (source.match(processedOrPaidGuard) ?? []).length;
    expect(guardCount).toBeGreaterThanOrEqual(2);
  });
  it('J: with two transitions, only the final active segment is widened and earns Basic', async () => {
    const logs = fullMonthPresentLogs();
    const AUG_10 = new Date(Date.UTC(2026, 7, 10, 0, 0, 0));
    const AUG_21 = new Date(Date.UTC(2026, 7, 21, 0, 0, 0));
    const { breakdown: seg1 } = await computeSegment(logs, { basicStipend: 20000, effectiveFrom: FAR_PAST, effectiveTo: AUG_10 });
    const { breakdown: seg2 } = await computeSegment(logs, { basicStipend: 24000, effectiveFrom: AUG_10, effectiveTo: AUG_21 });
    const { breakdown: seg3 } = await computeSegment(logs, { basicStipend: 28000, effectiveFrom: AUG_21, effectiveTo: null });
    expect(seg1.policyCreditMinutes).toBe(0);
    expect(seg2.policyCreditMinutes).toBe(0);
    expect(seg3.policyCreditMinutes).toBe(31 * FULL_DAY_MINUTES);
    expect(seg1.hourlyBasicEarned).toBe(0);
    expect(seg2.hourlyBasicEarned).toBe(0);
    expect(seg3.hourlyBasicEarned).toBe(28000);
  });
  it('denominator policy: hourlyRate uses the full calendar-month day count, not the segment day count', async () => {
    const logs = fullMonthPresentLogs();
    const { service } = makeSegmentAwareService(logs);

    const breakdown = await (service as any).computeHourlyBreakdown('emp-1', 8, 2026, {
      stipendRecord: { basicStipend: 24800, effectiveFrom: FAR_PAST, effectiveTo: AUG_15 },
      employee: EMPLOYEE,
      existingDeductions: [],
      existingAllowances: [],
      asOf: new Date(Date.UTC(2026, 8, 1)),
      applyContractualPackage: true, // isolate the denominator, not the 2026-09-04 zero-closed-segment rule
    });
    expect(breakdown.hourlyRate).toBe(computeHourlyRate(24800, 8, 31));
    expect(breakdown.hourlyRate).not.toBe(computeHourlyRate(24800, 8, 14));
    expect(breakdown.hourlyBasicEarned).toBe(24800);
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
    expect(b.fixedAllowances).toBe(roundMoney((10000 * 19) / 30));
    expect(b.netStipend).toBe(roundMoney(19000 + (10000 * 19) / 30));
  });

  it('salary follows stored Card PRESENT dates rather than applying a second joining-date filter', async () => {
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
    expect(b.policyCreditMinutes).toBe(2 * FULL_DAY_MINUTES);
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

  it('A: 28 stored PRESENT days earn 28 daily rates; missing dates are not invented', async () => {
    const logs = logsForDays(Array.from({ length: 28 }, (_, i) => i + 1));
    const b = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 100000, effectiveFrom: FAR_PAST, effectiveTo: null },
    });
    expect(b.creditedAttendanceDays).toBe(28);
    expect(b.payrollBasicStipend).toBe(roundMoney(100000 * 28 / 31));
    expect(b.netStipend).toBe(roundMoney(100000 * 28 / 31));
  });

  it('B: different packages apply their daily rate to the same Card day count', async () => {
    const logs = logsForDays(Array.from({ length: 28 }, (_, i) => i + 1));
    const b25 = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 25000, effectiveFrom: FAR_PAST, effectiveTo: null },
    });
    const b18 = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 18000, effectiveFrom: FAR_PAST, effectiveTo: null },
    });
    expect(b25.payrollBasicStipend).toBe(roundMoney(25000 * 28 / 31));
    expect(b18.payrollBasicStipend).toBe(roundMoney(18000 * 28 / 31));
  });

  it('C: adding three final PRESENT dates adds three daily rates', async () => {
    const through28 = logsForDays(Array.from({ length: 28 }, (_, i) => i + 1));
    const full = logsForDays(Array.from({ length: 31 }, (_, i) => i + 1));
    const stipend = {
      stipendRecord: { basicStipend: 100000, effectiveFrom: FAR_PAST, effectiveTo: null },
    };
    const before = await computeBreakdown(through28, stipend);
    const after = await computeBreakdown(full, stipend);
    expect(before.payrollBasicStipend).toBe(roundMoney(100000 * 28 / 31));
    expect(after.payrollBasicStipend).toBe(100000);
    expect(before.creditedAttendanceDays).toBe(28);
    expect(after.creditedAttendanceDays).toBe(31);
  });

  it('D: ABSENT and UNMARKED earn zero; Late earns a day; legacy attendance deductions do not stack', async () => {
    const logs = [
      ...logsForDays([1, 2], AttendanceStatus.ABSENT),
      ...logsForDays([3], AttendanceStatus.UNMARKED),
      ...logsForDays([4], AttendanceStatus.LATE),
      ...logsForDays(Array.from({ length: 24 }, (_, i) => i + 5)),
    ];
    const b = await computeBreakdown(logs, {
      stipendRecord: { basicStipend: 100000, effectiveFrom: FAR_PAST, effectiveTo: null },
      existingDeductions: [{ amount: 6451.61, reason: 'UNINFORMED_ABSENCE' }],
    });
    expect(b.creditedAttendanceDays).toBe(25);
    const expectedBasic = roundMoney(100000 * 25 / 31);
    expect(b.payrollBasicStipend).toBe(expectedBasic);
    expect(b.disciplineDeductions).toBe(6451.61);
    expect(b.netStipend).toBe(roundMoney(expectedBasic - 6451.61));
  });

  it('E: mid-month stipend start earns only the two stored PRESENT dates', async () => {
    const aug15 = new Date(Date.UTC(2026, 7, 15));
    const fewLogs = logsForDays([15, 16]);
    const b = await computeBreakdown(fewLogs, {
      stipendRecord: { basicStipend: 100000, effectiveFrom: aug15, effectiveTo: null },
    });
    expect(b.creditedAttendanceDays).toBe(2);
    expect(b.payrollBasicStipend).toBe(roundMoney((100000 * 2) / 31));
  });

  it('E2: mid-month joiningDate does not turn unlogged days into paid attendance', async () => {
    const fewLogs = logsForDays([15, 16]);
    const b = await computeBreakdown(fewLogs, {
      stipendRecord: { basicStipend: 100000, effectiveFrom: FAR_PAST, effectiveTo: null },
      employee: { joiningDate: new Date(Date.UTC(2026, 7, 15)) },
    });
    expect(b.creditedAttendanceDays).toBe(2);
    expect(b.payrollBasicStipend).toBe(roundMoney((100000 * 2) / 31));
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
    expect(b.creditedAttendanceDays).toBe(28);
    expect(b.payrollBasicStipend).toBe(roundMoney(30000 * 28 / 31));
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
    expect(b.payrollBasicStipend).toBe(roundMoney(30000 * 28 / 31));
    expect(b.fixedAllowances).toBe(5000);
  });

  it('fixed allowances remain the monthly package while Basic uses all final Card days', async () => {
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
    expect(b.payrollBasicStipend).toBe(roundMoney((30000 * 28) / 31));
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

  it('F: closed segment earns zero and the active owner earns the whole Card month', async () => {
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
    expect(oldSeg.payrollBasicStipend).toBe(0);
    expect(newSeg.payrollBasicStipend).toBe(27900);
  });

  it('SHORT_LEAVE earns one full daily rate without inventing the other dates', async () => {
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
    const expectedBasic = roundMoney(100000 / 31);
    expect(b.payrollBasicStipend).toBe(expectedBasic);
    expect(b.netStipend).toBe(roundMoney(expectedBasic + 2000 - 5000));
  });
});
