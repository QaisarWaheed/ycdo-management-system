import { AttendanceStatus, Prisma } from '@prisma/client';

// discipline.helper.ts imports issueAutoTemplatedLetter at module scope,
// which transitively pulls in puppeteer (ESM-only, breaks Jest's default
// CommonJS transform). Stub the module boundary — same pattern as every
// other discipline spec in this directory.
jest.mock('./../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));

import {
  applyDisciplineRules,
  applyMissingCheckoutDiscipline,
} from './discipline.helper';

/**
 * Step 4 (Gap #1) regression coverage: dated discipline incidents
 * (LATE fines, ABSENT/UNINFORMED_ABSENT deductions, missing-checkout fines)
 * must be priced against and attached to whichever StipendRecord segment
 * was actually EFFECTIVE ON the incident date — never "whichever record
 * happens to be active right now" — and PROCESSED/PAID historical segments
 * must stay frozen rather than silently moving the deduction onto the
 * current segment. See getStipendRecordEffectiveOn / getOrCreatePayrollEntry
 * in discipline.helper.ts.
 */

const EMP_ID = 'emp-seg-1';

type FakeStipend = {
  id: string;
  employeeId: string;
  basicStipend: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};
type FakeDeduction = {
  id: string;
  payrollEntryId: string;
  reason: string;
  amount: number;
  description: string;
};
type FakePayrollEntry = {
  id: string;
  stipendRecordId: string;
  month: number;
  year: number;
  status: 'PENDING' | 'PROCESSED' | 'PAID';
  totalDeductions: number;
  netStipend: number;
};
type FakeDisciplineEvent = {
  id: string;
  employeeId: string;
  category: string;
  incidentDate: string;
};

function makeSegmentFakeTx(seed: {
  stipendRecords: FakeStipend[];
  payrollEntries?: FakePayrollEntry[];
  deductions?: FakeDeduction[];
  /** Dates (YYYY-MM-DD) attendanceLog.findMany should report as prior
   * LATE/UNINFORMED_ABSENT/open-checkout days this month, for occurrence
   * counting. */
  priorDates?: string[];
  approvedLeaveCoversDate?: boolean;
}) {
  const stipendRecords = seed.stipendRecords;
  const payrollEntries =
    seed.payrollEntries ??
    stipendRecords.map((r, i) => ({
      id: `pe-default-${i}`,
      stipendRecordId: r.id,
      month: 8,
      year: 2026,
      status: 'PENDING' as const,
      totalDeductions: 0,
      netStipend: r.basicStipend,
    }));
  let deductions = seed.deductions ?? [];
  let disciplineEvents: FakeDisciplineEvent[] = [];
  const priorDates = seed.priorDates ?? [];

  const tx = {
    employee: {
      findUnique: jest.fn(
        (args: { where: { id: string }; select?: { status?: boolean } }) => {
          if (args.where.id !== EMP_ID) return null;
          if (args.select?.status) return { status: 'ACTIVE' };
          return { id: EMP_ID, dutyStartTime: '09:00', dutyEndTime: '17:00' };
        },
      ),
      update: jest.fn(() => ({ status: 'ACTIVE' })),
    },
    user: { updateMany: jest.fn(() => ({ count: 0 })) },
    leaveRecord: {
      findFirst: jest.fn(() =>
        seed.approvedLeaveCoversDate ? { id: 'lr-1' } : null,
      ),
    },
    attendanceLog: {
      findMany: jest.fn(() =>
        priorDates.map((d) => ({ date: new Date(`${d}T00:00:00.000Z`) })),
      ),
    },
    notification: { create: jest.fn(() => ({})) },
    stipendRecord: {
      findFirst: jest.fn(
        (args: {
          where: {
            employeeId: string;
            effectiveFrom: { lte: Date };
            OR: Array<{ effectiveTo: null | { gt: Date } }>;
          };
        }) => {
          const cutoff = args.where.effectiveFrom.lte;
          const matches = stipendRecords
            .filter((r) => r.employeeId === args.where.employeeId)
            .filter((r) => r.effectiveFrom.getTime() <= cutoff.getTime())
            .filter(
              (r) =>
                r.effectiveTo === null ||
                r.effectiveTo.getTime() > cutoff.getTime(),
            )
            .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
          return matches[0] ?? null;
        },
      ),
    },
    payrollEntry: {
      findUnique: jest.fn(
        (args: {
          where: {
            stipendRecordId_month_year: {
              stipendRecordId: string;
              month: number;
              year: number;
            };
          };
        }) => {
          const { stipendRecordId, month, year } =
            args.where.stipendRecordId_month_year;
          return (
            payrollEntries.find(
              (e) =>
                e.stipendRecordId === stipendRecordId &&
                e.month === month &&
                e.year === year,
            ) ?? null
          );
        },
      ),
      create: jest.fn(
        (args: {
          data: {
            stipendRecordId: string;
            month: number;
            year: number;
            basicStipend: number;
            netStipend: number;
          };
        }) => {
          const entry: FakePayrollEntry = {
            id: `pe-${payrollEntries.length + 1}`,
            stipendRecordId: args.data.stipendRecordId,
            month: args.data.month,
            year: args.data.year,
            status: 'PENDING',
            totalDeductions: 0,
            netStipend: args.data.netStipend,
          };
          payrollEntries.push(entry);
          return entry;
        },
      ),
      update: jest.fn(
        (args: {
          where: { id: string };
          data: {
            totalDeductions?: { increment?: number; decrement?: number };
            netStipend?: { increment?: number; decrement?: number };
          };
        }) => {
          const entry = payrollEntries.find((e) => e.id === args.where.id);
          if (!entry) throw new Error('no entry');
          const { totalDeductions, netStipend } = args.data;
          if (totalDeductions?.increment != null)
            entry.totalDeductions += totalDeductions.increment;
          if (totalDeductions?.decrement != null)
            entry.totalDeductions -= totalDeductions.decrement;
          if (netStipend?.increment != null)
            entry.netStipend += netStipend.increment;
          if (netStipend?.decrement != null)
            entry.netStipend -= netStipend.decrement;
          return entry;
        },
      ),
    },
    payrollDeduction: {
      findFirst: jest.fn(
        (args: {
          where: { payrollEntryId: string; reason: string; description: string };
        }) =>
          deductions.find(
            (d) =>
              d.payrollEntryId === args.where.payrollEntryId &&
              d.reason === args.where.reason &&
              d.description === args.where.description,
          ) ?? null,
      ),
      create: jest.fn(
        (args: {
          data: {
            payrollEntryId: string;
            reason: string;
            amount: number;
            description: string;
          };
        }) => {
          const d: FakeDeduction = {
            id: `ded-${deductions.length + 1}`,
            ...args.data,
          };
          deductions.push(d);
          return d;
        },
      ),
      delete: jest.fn((args: { where: { id: string } }) => {
        deductions = deductions.filter((d) => d.id !== args.where.id);
      }),
    },
    disciplineEvent: {
      create: jest.fn(
        (args: {
          data: {
            employeeId: string;
            category: string;
            incidentDate: Date;
            occurrence: number;
          };
        }) => {
          const incidentDate = args.data.incidentDate
            .toISOString()
            .slice(0, 10);
          const exists = disciplineEvents.find(
            (e) =>
              e.employeeId === args.data.employeeId &&
              e.category === args.data.category &&
              e.incidentDate === incidentDate,
          );
          if (exists) {
            const err = new Error('unique constraint') as Error & {
              code: string;
            };
            err.code = 'P2002';
            throw err;
          }
          const e: FakeDisciplineEvent = {
            id: `de-${disciplineEvents.length + 1}`,
            employeeId: args.data.employeeId,
            category: args.data.category,
            incidentDate,
          };
          disciplineEvents.push(e);
          return e;
        },
      ),
    },
    letter: {
      findMany: jest.fn(() => []),
    },
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    getPayrollEntries: () => payrollEntries,
    getDeductions: () => deductions,
  };
}

const OLD_RATE_BASIC = 24800; // /31 = 800/day
const NEW_RATE_BASIC = 31000; // /31 = 1000/day
const AUG_15 = new Date('2026-08-15T00:00:00.000Z'); // increment transition
const oldSr: FakeStipend = {
  id: 'sr-old',
  employeeId: EMP_ID,
  basicStipend: OLD_RATE_BASIC,
  effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
  effectiveTo: AUG_15,
};
const newSr: FakeStipend = {
  id: 'sr-new',
  employeeId: EMP_ID,
  basicStipend: NEW_RATE_BASIC,
  effectiveFrom: AUG_15,
  effectiveTo: null,
};

describe('discipline.helper — Step 4 dated-incident stipend-segment attribution', () => {
  // A. LATE fine dated BEFORE the increment attaches to the OLD segment.
  it('A: a LATE fine incident dated before the increment is priced and filed against the OLD segment', async () => {
    const { tx, getPayrollEntries, getDeductions } = makeSegmentFakeTx({
      stipendRecords: [oldSr, newSr],
      priorDates: ['2026-08-03', '2026-08-04'], // 2 prior LATE days -> this is the 3rd -> Fine
    });
    const incidentDate = new Date('2026-08-05T00:00:00.000Z');

    await applyDisciplineRules(tx, EMP_ID, AttendanceStatus.LATE, incidentDate, {
      lateMinutes: 30,
    });

    const entries = getPayrollEntries().filter((e) => e.totalDeductions > 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].stipendRecordId).toBe('sr-old');
    const dedns = getDeductions();
    expect(dedns).toHaveLength(1);
    expect(dedns[0].amount).toBeCloseTo(OLD_RATE_BASIC / 31, 5);
  });

  // B. LATE fine dated on/after the increment attaches to the NEW segment.
  it('B: a LATE fine incident dated after the increment is priced and filed against the NEW segment', async () => {
    const { tx, getPayrollEntries, getDeductions } = makeSegmentFakeTx({
      stipendRecords: [oldSr, newSr],
      priorDates: ['2026-08-16', '2026-08-17'],
    });
    const incidentDate = new Date('2026-08-18T00:00:00.000Z');

    await applyDisciplineRules(tx, EMP_ID, AttendanceStatus.LATE, incidentDate, {
      lateMinutes: 30,
    });

    const entries = getPayrollEntries().filter((e) => e.totalDeductions > 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].stipendRecordId).toBe('sr-new');
    const dedns = getDeductions();
    expect(dedns[0].amount).toBeCloseTo(NEW_RATE_BASIC / 31, 5);
  });

  // C. UNINFORMED_ABSENT old-segment incident attaches correctly, priced at
  // the OLD rate, and never touches a NEW-segment PayrollEntry.
  it('C: an UNINFORMED_ABSENT incident dated in the OLD segment deducts at the OLD rate against the OLD segment only', async () => {
    const { tx, getPayrollEntries } = makeSegmentFakeTx({
      stipendRecords: [oldSr, newSr],
    });
    const incidentDate = new Date('2026-08-02T00:00:00.000Z');

    await applyDisciplineRules(
      tx,
      EMP_ID,
      AttendanceStatus.UNINFORMED_ABSENT,
      incidentDate,
    );

    const entries = getPayrollEntries().filter((e) => e.totalDeductions > 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].stipendRecordId).toBe('sr-old');
    expect(entries[0].totalDeductions).toBeCloseTo((OLD_RATE_BASIC / 31) * 2, 5);
  });

  // D. Missing-checkout fine attaches to the segment effective on the
  // incident date (OLD segment here).
  it('D: a missing-checkout fine is priced and filed against the segment effective on the incident date', async () => {
    const { tx, getPayrollEntries } = makeSegmentFakeTx({
      stipendRecords: [oldSr, newSr],
      priorDates: ['2026-08-06', '2026-08-07'], // 2 prior open days -> this is the 3rd -> Fine
    });
    const incidentDate = new Date('2026-08-08T00:00:00.000Z');

    await applyMissingCheckoutDiscipline(tx, EMP_ID, incidentDate, {
      checkIn: new Date('2026-08-08T04:00:00.000Z'),
      dutyEndTime: '17:00',
    });

    const entries = getPayrollEntries().filter((e) => e.totalDeductions > 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].stipendRecordId).toBe('sr-old');
    expect(entries[0].totalDeductions).toBeCloseTo(OLD_RATE_BASIC / 31, 5);
  });

  // E. Transition-date incident (exactly effectiveFrom of the new record)
  // belongs to the NEW segment — half-open [effectiveFrom, effectiveTo).
  it('E: an ABSENT incident dated exactly on the transition date belongs to the NEW segment', async () => {
    const { tx, getPayrollEntries } = makeSegmentFakeTx({
      stipendRecords: [oldSr, newSr],
    });

    await applyDisciplineRules(tx, EMP_ID, AttendanceStatus.ABSENT, AUG_15);

    const entries = getPayrollEntries().filter((e) => e.totalDeductions > 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].stipendRecordId).toBe('sr-new');
    expect(entries[0].totalDeductions).toBeCloseTo((NEW_RATE_BASIC / 31) * 2, 5);
  });

  // F. PROCESSED historical segment stays frozen — deduction is NOT applied,
  // totals are NOT touched.
  it('F: a PROCESSED old-segment PayrollEntry is never mutated by a new dated incident — deduction is blocked, not moved', async () => {
    const frozenEntry: FakePayrollEntry = {
      id: 'pe-old-frozen',
      stipendRecordId: 'sr-old',
      month: 8,
      year: 2026,
      status: 'PROCESSED',
      totalDeductions: 0,
      netStipend: OLD_RATE_BASIC,
    };
    const { tx, getPayrollEntries, getDeductions } = makeSegmentFakeTx({
      stipendRecords: [oldSr, newSr],
      payrollEntries: [frozenEntry],
    });
    const incidentDate = new Date('2026-08-02T00:00:00.000Z');

    const result = await applyDisciplineRules(
      tx,
      EMP_ID,
      AttendanceStatus.UNINFORMED_ABSENT,
      incidentDate,
    );

    expect(getDeductions()).toHaveLength(0);
    const entries = getPayrollEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].totalDeductions).toBe(0); // untouched
    expect(entries[0].status).toBe('PROCESSED'); // never silently moved to the new (active) segment either
  });

  // G. A PAID old-segment PayrollEntry is the one a LATE fine's date-based
  // resolution correctly targets — it must never be silently redirected to
  // the (unrelated, currently-active) NEW segment merely because the old
  // one is frozen, AND (financial-safety follow-up fix) the frozen entry
  // itself must never be mutated either. See
  // discipline.late-fine-freeze.spec.ts for the full PROCESSED/PAID freeze
  // coverage of applyLateDiscipline's fine branch.
  it('G: a LATE fine resolves to the correct (old, PAID) segment by incident date and never mutates it or the active segment', async () => {
    const frozenEntry: FakePayrollEntry = {
      id: 'pe-old-paid',
      stipendRecordId: 'sr-old',
      month: 8,
      year: 2026,
      status: 'PAID',
      totalDeductions: 500,
      netStipend: OLD_RATE_BASIC - 500,
    };
    const { tx, getPayrollEntries, getDeductions } = makeSegmentFakeTx({
      stipendRecords: [oldSr, newSr],
      payrollEntries: [frozenEntry],
      priorDates: ['2026-08-03', '2026-08-04'],
    });
    const incidentDate = new Date('2026-08-05T00:00:00.000Z');

    await applyDisciplineRules(tx, EMP_ID, AttendanceStatus.LATE, incidentDate, {
      lateMinutes: 30,
    });

    // Exactly one entry ever existed/was touched — the old, PAID one. No
    // second entry was created against the active (new) segment, and the
    // frozen entry's own totals are untouched.
    const entries = getPayrollEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].stipendRecordId).toBe('sr-old');
    expect(entries[0].totalDeductions).toBe(500);
    expect(getDeductions()).toHaveLength(0);
  });

  // H. Idempotency: re-applying the same dated incident twice never
  // double-deducts, and both calls resolve to the same historical segment.
  it('H: re-applying the same ABSENT-family incident twice is idempotent and always resolves to the same segment', async () => {
    const { tx, getPayrollEntries, getDeductions } = makeSegmentFakeTx({
      stipendRecords: [oldSr, newSr],
    });
    const incidentDate = new Date('2026-08-02T00:00:00.000Z');

    await applyDisciplineRules(
      tx,
      EMP_ID,
      AttendanceStatus.UNINFORMED_ABSENT,
      incidentDate,
    );
    const afterFirst = getPayrollEntries().find(
      (e) => e.stipendRecordId === 'sr-old',
    )!.totalDeductions;
    expect(getDeductions()).toHaveLength(1);

    await applyDisciplineRules(
      tx,
      EMP_ID,
      AttendanceStatus.UNINFORMED_ABSENT,
      incidentDate,
    );

    // DisciplineEvent's unique claim makes the second call a true no-op —
    // no second deduction row, totals unchanged.
    expect(getDeductions()).toHaveLength(1);
    const entries = getPayrollEntries().filter((e) => e.totalDeductions > 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].stipendRecordId).toBe('sr-old');
    expect(entries[0].totalDeductions).toBe(afterFirst);
    expect(entries[0].totalDeductions).toBeCloseTo((OLD_RATE_BASIC / 31) * 2, 5);
  });
});
