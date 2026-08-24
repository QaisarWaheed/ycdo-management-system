import { LetterType, Prisma } from '@prisma/client';

// discipline.helper.ts imports issueAutoTemplatedLetter at module scope,
// which transitively pulls in puppeteer (ESM-only, breaks Jest's default
// CommonJS transform). Stub the module boundary — same pattern as every
// other discipline spec in this directory.
jest.mock('./../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));

import { issueAutoTemplatedLetter } from '../letters/auto-letter.helper';
import {
  applyMissingCheckoutDiscipline,
  AUTO_DISCIPLINE,
  reverseMissingCheckoutDisciplineForDate,
} from './discipline.helper';

/**
 * Financial-safety follow-up to discipline.late-fine-freeze.spec.ts:
 * applyMissingCheckoutDiscipline's fine branch had the exact same missing
 * PayrollEntry.status guard applyLateDiscipline's fine branch had before
 * that fix — its own reversal (reverseMissingCheckoutDisciplineForDate)
 * already refuses to mutate a PROCESSED/PAID entry, so apply/reverse were
 * asymmetric. This suite covers the new guard end to end: PENDING
 * unaffected, PROCESSED/PAID frozen (never mutated AND never redirected to
 * another segment), transition-date segmentation still correct, reversal
 * already-symmetric, and discipline tracking (DisciplineEvent claim + FINE
 * letter) still proceeds even when the financial mutation is frozen.
 */

const issueAutoTemplatedLetterMock = issueAutoTemplatedLetter as jest.Mock;

const EMP_ID = 'emp-mc-freeze-1';

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
  occurrence: number;
};
type FakeLetter = {
  id: string;
  letterType: LetterType;
  generatedAt: Date;
  variables: Record<string, unknown>;
  requiresAcknowledgement: boolean;
};

function makeFreezeFakeTx(seed: {
  stipendRecords: FakeStipend[];
  payrollEntries?: FakePayrollEntry[];
  deductions?: FakeDeduction[];
  /**
   * Prior MISSING_CHECKOUT incident dates (YYYY-MM-DD) already claimed this
   * month. Used to seed DisciplineEvent rows for chronological occurrence
   * counting (replaces the old open-AttendanceLog count).
   */
  priorOpenDates?: string[];
  letters?: FakeLetter[];
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
  const priorOpenDates = seed.priorOpenDates ?? [];
  let disciplineEvents: FakeDisciplineEvent[] = priorOpenDates.map((d, i) => ({
    id: `de-prior-${i + 1}`,
    employeeId: EMP_ID,
    category: 'MISSING_CHECKOUT',
    incidentDate: d,
    occurrence: i + 1,
  }));
  const letters = seed.letters ?? [];

  const tx = {
    employee: {
      findUnique: jest.fn((args: { where: { id: string } }) => {
        if (args.where.id !== EMP_ID) return null;
        return { id: EMP_ID, dutyStartTime: '09:00', dutyEndTime: '17:00' };
      }),
    },
    attendanceLog: {
      findMany: jest.fn(() =>
        priorOpenDates.map((d) => ({ date: new Date(`${d}T00:00:00.000Z`) })),
      ),
    },
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
      count: jest.fn(
        (args: {
          where: {
            employeeId: string;
            category: string;
            incidentDate: { gte: Date; lt: Date };
          };
        }) => {
          const gte = args.where.incidentDate.gte.toISOString().slice(0, 10);
          const lt = args.where.incidentDate.lt.toISOString().slice(0, 10);
          return disciplineEvents.filter(
            (e) =>
              e.employeeId === args.where.employeeId &&
              e.category === args.where.category &&
              e.incidentDate >= gte &&
              e.incidentDate < lt,
          ).length;
        },
      ),
      findMany: jest.fn(
        (args: {
          where: {
            employeeId: string;
            category: string;
            incidentDate: { gte: Date; lte: Date };
          };
          orderBy?: { incidentDate: 'asc' };
          select?: { id: true; occurrence: true };
        }) => {
          const gte = args.where.incidentDate.gte.toISOString().slice(0, 10);
          const lte = args.where.incidentDate.lte.toISOString().slice(0, 10);
          const rows = disciplineEvents
            .filter(
              (e) =>
                e.employeeId === args.where.employeeId &&
                e.category === args.where.category &&
                e.incidentDate >= gte &&
                e.incidentDate <= lte,
            )
            .sort((a, b) => a.incidentDate.localeCompare(b.incidentDate));
          return rows.map((e) => ({ id: e.id, occurrence: e.occurrence }));
        },
      ),
      findUnique: jest.fn(
        (args: {
          where: {
            employeeId_category_incidentDate: {
              employeeId: string;
              category: string;
              incidentDate: Date;
            };
          };
          select?: { occurrence: true };
        }) => {
          const key = args.where.employeeId_category_incidentDate;
          const incidentDate = key.incidentDate.toISOString().slice(0, 10);
          const e = disciplineEvents.find(
            (row) =>
              row.employeeId === key.employeeId &&
              row.category === key.category &&
              row.incidentDate === incidentDate,
          );
          return e ? { occurrence: e.occurrence } : null;
        },
      ),
      update: jest.fn(
        (args: { where: { id: string }; data: { occurrence: number } }) => {
          const e = disciplineEvents.find((row) => row.id === args.where.id);
          if (!e) throw new Error('discipline event not found');
          e.occurrence = args.data.occurrence;
          return e;
        },
      ),
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
            occurrence: args.data.occurrence,
          };
          disciplineEvents.push(e);
          return e;
        },
      ),
      deleteMany: jest.fn(
        (args: {
          where: { employeeId: string; category: string; incidentDate: Date };
        }) => {
          const incidentDate = args.where.incidentDate
            .toISOString()
            .slice(0, 10);
          const before = disciplineEvents.length;
          disciplineEvents = disciplineEvents.filter(
            (e) =>
              !(
                e.employeeId === args.where.employeeId &&
                e.category === args.where.category &&
                e.incidentDate === incidentDate
              ),
          );
          return { count: before - disciplineEvents.length };
        },
      ),
    },
    letter: {
      findMany: jest.fn(() => letters),
      update: jest.fn(
        (args: {
          where: { id: string };
          data: {
            variables: Record<string, unknown>;
            requiresAcknowledgement?: boolean;
          };
        }) => {
          const letter = letters.find((l) => l.id === args.where.id);
          if (!letter) throw new Error('letter not found');
          letter.variables = args.data.variables;
          if (args.data.requiresAcknowledgement !== undefined) {
            letter.requiresAcknowledgement = args.data.requiresAcknowledgement;
          }
          return letter;
        },
      ),
    },
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    getPayrollEntries: () => payrollEntries,
    getDeductions: () => deductions,
    getDisciplineEvents: () => disciplineEvents,
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
const singleSr: FakeStipend = {
  id: 'sr-single',
  employeeId: EMP_ID,
  basicStipend: OLD_RATE_BASIC,
  effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
  effectiveTo: null,
};

// 3rd missing-checkout day this month -> Fine branch (the only branch with
// a financial mutation), so every scenario below seeds exactly 2 prior
// open days.
const FINE_INCIDENT_DATE = new Date('2026-08-05T00:00:00.000Z');
const FINE_PRIOR_DATES = ['2026-08-03', '2026-08-04'];
const CHECKOUT_OPTIONS = {
  checkIn: new Date('2026-08-05T04:00:00.000Z'),
  dutyEndTime: '17:00',
};

beforeEach(() => {
  AUTO_DISCIPLINE.lettersAndSuspendEnabled = true;
  issueAutoTemplatedLetterMock.mockClear();
});

afterEach(() => {
  AUTO_DISCIPLINE.lettersAndSuspendEnabled = false;
});

describe('discipline.helper — missing-checkout fine PROCESSED/PAID financial freeze', () => {
  // A. PENDING missing-checkout fine works unchanged.
  it('A: a PENDING PayrollEntry still receives the missing-checkout fine exactly as before', async () => {
    const { tx, getPayrollEntries, getDeductions } = makeFreezeFakeTx({
      stipendRecords: [singleSr],
      priorOpenDates: FINE_PRIOR_DATES,
    });

    await applyMissingCheckoutDiscipline(
      tx,
      EMP_ID,
      FINE_INCIDENT_DATE,
      CHECKOUT_OPTIONS,
    );

    const entries = getPayrollEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('PENDING');
    expect(entries[0].totalDeductions).toBeCloseTo(OLD_RATE_BASIC / 31, 5);
    expect(getDeductions()).toHaveLength(1);
  });

  // B. PROCESSED target segment gets no financial mutation.
  it('B: a PROCESSED PayrollEntry (single segment) receives no financial mutation from a new missing-checkout fine', async () => {
    const frozenEntry: FakePayrollEntry = {
      id: 'pe-processed',
      stipendRecordId: singleSr.id,
      month: 8,
      year: 2026,
      status: 'PROCESSED',
      totalDeductions: 1200,
      netStipend: OLD_RATE_BASIC - 1200,
    };
    const { tx, getPayrollEntries, getDeductions } = makeFreezeFakeTx({
      stipendRecords: [singleSr],
      payrollEntries: [frozenEntry],
      priorOpenDates: FINE_PRIOR_DATES,
    });

    await applyMissingCheckoutDiscipline(
      tx,
      EMP_ID,
      FINE_INCIDENT_DATE,
      CHECKOUT_OPTIONS,
    );

    expect(getDeductions()).toHaveLength(0);
    const entries = getPayrollEntries();
    expect(entries).toHaveLength(1); // no replacement entry created
    expect(entries[0].status).toBe('PROCESSED');
    expect(entries[0].totalDeductions).toBe(1200); // untouched
  });

  // C. PAID target segment gets no financial mutation.
  it('C: a PAID PayrollEntry (single segment) receives no financial mutation from a new missing-checkout fine', async () => {
    const frozenEntry: FakePayrollEntry = {
      id: 'pe-paid',
      stipendRecordId: singleSr.id,
      month: 8,
      year: 2026,
      status: 'PAID',
      totalDeductions: 800,
      netStipend: OLD_RATE_BASIC - 800,
    };
    const { tx, getPayrollEntries, getDeductions } = makeFreezeFakeTx({
      stipendRecords: [singleSr],
      payrollEntries: [frozenEntry],
      priorOpenDates: FINE_PRIOR_DATES,
    });

    await applyMissingCheckoutDiscipline(
      tx,
      EMP_ID,
      FINE_INCIDENT_DATE,
      CHECKOUT_OPTIONS,
    );

    expect(getDeductions()).toHaveLength(0);
    const entries = getPayrollEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('PAID');
    expect(entries[0].totalDeductions).toBe(800); // untouched
  });

  // D. Old-segment incident + old segment PROCESSED does not redirect to
  // the new (currently-active) PENDING segment.
  it('D: an old-segment incident with the old segment PROCESSED does not redirect the fine to the new PENDING segment', async () => {
    const frozenOld: FakePayrollEntry = {
      id: 'pe-old-processed',
      stipendRecordId: oldSr.id,
      month: 8,
      year: 2026,
      status: 'PROCESSED',
      totalDeductions: 0,
      netStipend: OLD_RATE_BASIC,
    };
    const { tx, getPayrollEntries, getDeductions } = makeFreezeFakeTx({
      stipendRecords: [oldSr, newSr],
      payrollEntries: [frozenOld],
      priorOpenDates: FINE_PRIOR_DATES,
    });

    await applyMissingCheckoutDiscipline(
      tx,
      EMP_ID,
      FINE_INCIDENT_DATE,
      CHECKOUT_OPTIONS,
    );

    expect(getDeductions()).toHaveLength(0);
    const entries = getPayrollEntries();
    // No new-segment entry was ever created for this incident.
    expect(entries).toHaveLength(1);
    expect(entries[0].stipendRecordId).toBe('sr-old');
    expect(entries[0].totalDeductions).toBe(0);
  });

  // E. Old-segment incident + old segment PAID: same.
  it('E: an old-segment incident with the old segment PAID does not redirect the fine to the new PENDING segment', async () => {
    const frozenOld: FakePayrollEntry = {
      id: 'pe-old-paid',
      stipendRecordId: oldSr.id,
      month: 8,
      year: 2026,
      status: 'PAID',
      totalDeductions: 0,
      netStipend: OLD_RATE_BASIC,
    };
    const { tx, getPayrollEntries, getDeductions } = makeFreezeFakeTx({
      stipendRecords: [oldSr, newSr],
      payrollEntries: [frozenOld],
      priorOpenDates: FINE_PRIOR_DATES,
    });

    await applyMissingCheckoutDiscipline(
      tx,
      EMP_ID,
      FINE_INCIDENT_DATE,
      CHECKOUT_OPTIONS,
    );

    expect(getDeductions()).toHaveLength(0);
    const entries = getPayrollEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].stipendRecordId).toBe('sr-old');
    expect(entries[0].totalDeductions).toBe(0);
  });

  // F. Transition-date incident still resolves to the NEW stipend segment
  // (segmentation untouched by the freeze guard).
  it('F: a transition-date missing-checkout fine still resolves to and mutates the NEW segment (PENDING)', async () => {
    const { tx, getPayrollEntries } = makeFreezeFakeTx({
      stipendRecords: [oldSr, newSr],
      priorOpenDates: ['2026-08-13', '2026-08-14'],
    });

    await applyMissingCheckoutDiscipline(tx, EMP_ID, AUG_15, {
      checkIn: new Date('2026-08-15T04:00:00.000Z'),
      dutyEndTime: '17:00',
    });

    const entries = getPayrollEntries().filter((e) => e.totalDeductions > 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].stipendRecordId).toBe('sr-new'); // half-open: effectiveFrom inclusive
    expect(entries[0].totalDeductions).toBeCloseTo(NEW_RATE_BASIC / 31, 5);
  });

  // G. Reversal on PENDING works unchanged.
  it('G: reversing a missing-checkout FINE on a PENDING entry still deletes the deduction and restores totals', async () => {
    const entry: FakePayrollEntry = {
      id: 'pe-pending-rev',
      stipendRecordId: singleSr.id,
      month: 8,
      year: 2026,
      status: 'PENDING',
      totalDeductions: 800,
      netStipend: OLD_RATE_BASIC - 800,
    };
    const deduction: FakeDeduction = {
      id: 'ded-1',
      payrollEntryId: entry.id,
      reason: 'DISCIPLINARY_FINE',
      amount: 800,
      description: 'Missing checkout deduction — monthly occurrence 3',
    };
    const letter: FakeLetter = {
      id: 'letter-1',
      letterType: LetterType.FINE,
      generatedAt: new Date('2026-08-05T00:00:00.000Z'),
      variables: {
        monthlyMissingCheckoutOccurrence: 3,
        incidentDate: '2026-08-05',
      },
      requiresAcknowledgement: true,
    };
    const { tx, getPayrollEntries, getDeductions } = makeFreezeFakeTx({
      stipendRecords: [singleSr],
      payrollEntries: [entry],
      deductions: [deduction],
      letters: [letter],
    });

    const result = await reverseMissingCheckoutDisciplineForDate(
      tx,
      EMP_ID,
      FINE_INCIDENT_DATE,
    );

    expect(result.reversed).toBe(true);
    expect(result.deductionReversed).toBe(true);
    expect(result.blockedByPayrollStatus).toBe(false);
    expect(getDeductions()).toHaveLength(0);
    expect(getPayrollEntries()[0].totalDeductions).toBe(0);
  });

  // H. Reversal on PROCESSED does not mutate financial rows.
  it('H: reversing a missing-checkout FINE on a PROCESSED entry leaves the deduction and totals untouched', async () => {
    const entry: FakePayrollEntry = {
      id: 'pe-processed-rev',
      stipendRecordId: singleSr.id,
      month: 8,
      year: 2026,
      status: 'PROCESSED',
      totalDeductions: 800,
      netStipend: OLD_RATE_BASIC - 800,
    };
    const deduction: FakeDeduction = {
      id: 'ded-1',
      payrollEntryId: entry.id,
      reason: 'DISCIPLINARY_FINE',
      amount: 800,
      description: 'Missing checkout deduction — monthly occurrence 3',
    };
    const letter: FakeLetter = {
      id: 'letter-1',
      letterType: LetterType.FINE,
      generatedAt: new Date('2026-08-05T00:00:00.000Z'),
      variables: {
        monthlyMissingCheckoutOccurrence: 3,
        incidentDate: '2026-08-05',
      },
      requiresAcknowledgement: true,
    };
    const { tx, getPayrollEntries, getDeductions } = makeFreezeFakeTx({
      stipendRecords: [singleSr],
      payrollEntries: [entry],
      deductions: [deduction],
      letters: [letter],
    });

    const result = await reverseMissingCheckoutDisciplineForDate(
      tx,
      EMP_ID,
      FINE_INCIDENT_DATE,
    );

    expect(result.reversed).toBe(true); // letter/DisciplineEvent side still reversed
    expect(result.deductionReversed).toBe(false);
    expect(result.blockedByPayrollStatus).toBe(true);
    expect(getDeductions()).toHaveLength(1); // untouched
    expect(getPayrollEntries()[0].totalDeductions).toBe(800); // untouched
  });

  // I. Reversal on PAID does not mutate financial rows.
  it('I: reversing a missing-checkout FINE on a PAID entry leaves the deduction and totals untouched', async () => {
    const entry: FakePayrollEntry = {
      id: 'pe-paid-rev',
      stipendRecordId: singleSr.id,
      month: 8,
      year: 2026,
      status: 'PAID',
      totalDeductions: 800,
      netStipend: OLD_RATE_BASIC - 800,
    };
    const deduction: FakeDeduction = {
      id: 'ded-1',
      payrollEntryId: entry.id,
      reason: 'DISCIPLINARY_FINE',
      amount: 800,
      description: 'Missing checkout deduction — monthly occurrence 3',
    };
    const letter: FakeLetter = {
      id: 'letter-1',
      letterType: LetterType.FINE,
      generatedAt: new Date('2026-08-05T00:00:00.000Z'),
      variables: {
        monthlyMissingCheckoutOccurrence: 3,
        incidentDate: '2026-08-05',
      },
      requiresAcknowledgement: true,
    };
    const { tx, getPayrollEntries, getDeductions } = makeFreezeFakeTx({
      stipendRecords: [singleSr],
      payrollEntries: [entry],
      deductions: [deduction],
      letters: [letter],
    });

    const result = await reverseMissingCheckoutDisciplineForDate(
      tx,
      EMP_ID,
      FINE_INCIDENT_DATE,
    );

    expect(result.reversed).toBe(true);
    expect(result.deductionReversed).toBe(false);
    expect(result.blockedByPayrollStatus).toBe(true);
    expect(getDeductions()).toHaveLength(1);
    expect(getPayrollEntries()[0].totalDeductions).toBe(800);
  });

  // J. DisciplineEvent / letter still behaves consistently when financial
  // mutation is frozen — the incident is still tracked (claimed) and the
  // FINE letter is still issued even though the money is frozen; the
  // freeze only blocks financial mutation, never the disciplinary record.
  it('J: DisciplineEvent is still claimed and the FINE letter is still issued when the target entry is frozen', async () => {
    const frozenEntry: FakePayrollEntry = {
      id: 'pe-processed-2',
      stipendRecordId: singleSr.id,
      month: 8,
      year: 2026,
      status: 'PROCESSED',
      totalDeductions: 0,
      netStipend: OLD_RATE_BASIC,
    };
    const { tx, getDisciplineEvents } = makeFreezeFakeTx({
      stipendRecords: [singleSr],
      payrollEntries: [frozenEntry],
      priorOpenDates: FINE_PRIOR_DATES,
    });

    await applyMissingCheckoutDiscipline(
      tx,
      EMP_ID,
      FINE_INCIDENT_DATE,
      CHECKOUT_OPTIONS,
    );

    expect(
      getDisciplineEvents().filter((e) => e.incidentDate === '2026-08-05'),
    ).toHaveLength(1); // incident still tracked
    expect(issueAutoTemplatedLetterMock).toHaveBeenCalledTimes(1); // FINE letter still issued
    const call = issueAutoTemplatedLetterMock.mock.calls[0][1];
    expect(call.letterType).toBe(LetterType.FINE);

    // A replay of the exact same incident is still idempotent (no second
    // DisciplineEvent, no second letter call) even though it's frozen.
    await applyMissingCheckoutDiscipline(
      tx,
      EMP_ID,
      FINE_INCIDENT_DATE,
      CHECKOUT_OPTIONS,
    );
    expect(
      getDisciplineEvents().filter((e) => e.incidentDate === '2026-08-05'),
    ).toHaveLength(1);
    expect(issueAutoTemplatedLetterMock).toHaveBeenCalledTimes(1);
  });
});
