import { AttendanceStatus, LetterType, Prisma } from '@prisma/client';

// discipline.helper.ts imports issueAutoTemplatedLetter at module scope,
// which transitively pulls in puppeteer (ESM-only, breaks Jest's default
// CommonJS transform). Stub the module boundary — same pattern as every
// other discipline spec in this directory.
jest.mock('./../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));

import { issueAutoTemplatedLetter } from '../letters/auto-letter.helper';
import {
  applyDisciplineRules,
  reverseLateDisciplineForDate,
} from './discipline.helper';

/**
 * Financial-safety blocker fix: applyLateDiscipline's fine-deduction branch
 * previously had NO PayrollEntry.status guard — unlike applyAbsentDeduction
 * / applyUninformedAbsentDeduction / reverseLateDisciplineForDate, all of
 * which already refuse to mutate a PROCESSED/PAID entry. A late fine for a
 * date whose (incident-date-correct, possibly historical) PayrollEntry had
 * already been finalized could still silently create a PayrollDeduction and
 * shift totalDeductions/netStipend on a payroll that should be immutable.
 *
 * This suite covers the new guard end to end: PENDING unaffected, PROCESSED/
 * PAID frozen (never mutated AND never redirected to another segment),
 * transition-date segmentation still correct, reversal already-symmetric,
 * and discipline tracking (DisciplineEvent claim + FINE letter) still
 * proceeds even when the financial mutation is frozen.
 */

const issueAutoTemplatedLetterMock = issueAutoTemplatedLetter as jest.Mock;

const EMP_ID = 'emp-freeze-1';

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
  priorLateDates?: string[];
  letters?: FakeLetter[];
}) {
  const stipendRecords = seed.stipendRecords;
  const payrollEntries = seed.payrollEntries ?? [];
  let deductions = seed.deductions ?? [];
  let disciplineEvents: FakeDisciplineEvent[] = [];
  const priorLateDates = seed.priorLateDates ?? [];
  const letters = seed.letters ?? [];

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
    leaveRecord: { findFirst: jest.fn(() => null) },
    attendanceLog: {
      findMany: jest.fn(() =>
        priorLateDates.map((d) => ({
          date: new Date(`${d}T00:00:00.000Z`),
          status: AttendanceStatus.LATE,
        })),
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

// 3rd LATE this month -> Fine branch (the only branch with a financial
// mutation), so every scenario below seeds exactly 2 prior LATE days.
const FINE_INCIDENT_DATE = new Date('2026-08-05T00:00:00.000Z');
const FINE_PRIOR_DATES = ['2026-08-03', '2026-08-04'];

beforeEach(() => {
  issueAutoTemplatedLetterMock.mockClear();
});

describe('discipline.helper — late-fine PROCESSED/PAID financial freeze', () => {
  // 1. PENDING late-fine path works unchanged.
  it('1: a PENDING PayrollEntry still receives the late fine exactly as before', async () => {
    const { tx, getPayrollEntries, getDeductions } = makeFreezeFakeTx({
      stipendRecords: [singleSr],
      priorLateDates: FINE_PRIOR_DATES,
    });

    await applyDisciplineRules(tx, EMP_ID, AttendanceStatus.LATE, FINE_INCIDENT_DATE, {
      lateMinutes: 30,
    });

    const entries = getPayrollEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('PENDING');
    expect(entries[0].totalDeductions).toBeCloseTo(OLD_RATE_BASIC / 31, 5);
    expect(getDeductions()).toHaveLength(1);
  });

  // 2. PROCESSED correct segment receives no financial mutation.
  it('2: a PROCESSED PayrollEntry (single segment) receives no financial mutation from a new late fine', async () => {
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
      priorLateDates: FINE_PRIOR_DATES,
    });

    await applyDisciplineRules(tx, EMP_ID, AttendanceStatus.LATE, FINE_INCIDENT_DATE, {
      lateMinutes: 30,
    });

    expect(getDeductions()).toHaveLength(0);
    const entries = getPayrollEntries();
    expect(entries).toHaveLength(1); // no replacement entry created
    expect(entries[0].status).toBe('PROCESSED');
    expect(entries[0].totalDeductions).toBe(1200); // untouched
  });

  // 3. PAID correct segment receives no financial mutation.
  it('3: a PAID PayrollEntry (single segment) receives no financial mutation from a new late fine', async () => {
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
      priorLateDates: FINE_PRIOR_DATES,
    });

    await applyDisciplineRules(tx, EMP_ID, AttendanceStatus.LATE, FINE_INCIDENT_DATE, {
      lateMinutes: 30,
    });

    expect(getDeductions()).toHaveLength(0);
    const entries = getPayrollEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('PAID');
    expect(entries[0].totalDeductions).toBe(800); // untouched
  });

  // 4. Old-segment incident + old segment PROCESSED: fine is NOT
  // redirected to the new (currently-active) PENDING segment.
  it('4: an old-segment incident with the old segment PROCESSED does not redirect the fine to the new PENDING segment', async () => {
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
      priorLateDates: FINE_PRIOR_DATES,
    });

    await applyDisciplineRules(tx, EMP_ID, AttendanceStatus.LATE, FINE_INCIDENT_DATE, {
      lateMinutes: 30,
    });

    expect(getDeductions()).toHaveLength(0);
    const entries = getPayrollEntries();
    // No new-segment entry was ever created for this incident.
    expect(entries).toHaveLength(1);
    expect(entries[0].stipendRecordId).toBe('sr-old');
    expect(entries[0].totalDeductions).toBe(0);
  });

  // 5. Old-segment incident + old segment PAID: same.
  it('5: an old-segment incident with the old segment PAID does not redirect the fine to the new PENDING segment', async () => {
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
      priorLateDates: FINE_PRIOR_DATES,
    });

    await applyDisciplineRules(tx, EMP_ID, AttendanceStatus.LATE, FINE_INCIDENT_DATE, {
      lateMinutes: 30,
    });

    expect(getDeductions()).toHaveLength(0);
    const entries = getPayrollEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].stipendRecordId).toBe('sr-old');
    expect(entries[0].totalDeductions).toBe(0);
  });

  // 6. Transition-date incident still resolves to the NEW stipend segment
  // (segmentation untouched by the freeze guard).
  it('6: a transition-date late fine still resolves to and mutates the NEW segment (PENDING)', async () => {
    const { tx, getPayrollEntries } = makeFreezeFakeTx({
      stipendRecords: [oldSr, newSr],
      priorLateDates: ['2026-08-13', '2026-08-14'],
    });

    await applyDisciplineRules(tx, EMP_ID, AttendanceStatus.LATE, AUG_15, {
      lateMinutes: 30,
    });

    const entries = getPayrollEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].stipendRecordId).toBe('sr-new'); // half-open: effectiveFrom inclusive
    expect(entries[0].totalDeductions).toBeCloseTo(NEW_RATE_BASIC / 31, 5);
  });

  // 7. Late reversal on PENDING works unchanged.
  it('7: reversing a FINE on a PENDING entry still deletes the deduction and restores totals', async () => {
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
      reason: 'LATE_ARRIVAL',
      amount: 800,
      description: 'Late arrival deduction — monthly occurrence 3',
    };
    const letter: FakeLetter = {
      id: 'letter-1',
      letterType: LetterType.FINE,
      generatedAt: new Date('2026-08-05T00:00:00.000Z'),
      variables: { monthlyLateOccurrence: 3, incidentDate: '2026-08-05' },
      requiresAcknowledgement: true,
    };
    const { tx, getPayrollEntries, getDeductions } = makeFreezeFakeTx({
      stipendRecords: [singleSr],
      payrollEntries: [entry],
      deductions: [deduction],
      letters: [letter],
    });

    const result = await reverseLateDisciplineForDate(tx, EMP_ID, FINE_INCIDENT_DATE);

    expect(result.reversed).toBe(true);
    expect(result.deductionReversed).toBe(true);
    expect(result.blockedByPayrollStatus).toBe(false);
    expect(getDeductions()).toHaveLength(0);
    expect(getPayrollEntries()[0].totalDeductions).toBe(0);
  });

  // 8. Late reversal on PROCESSED does not mutate financial rows.
  it('8: reversing a FINE on a PROCESSED entry leaves the deduction and totals untouched', async () => {
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
      reason: 'LATE_ARRIVAL',
      amount: 800,
      description: 'Late arrival deduction — monthly occurrence 3',
    };
    const letter: FakeLetter = {
      id: 'letter-1',
      letterType: LetterType.FINE,
      generatedAt: new Date('2026-08-05T00:00:00.000Z'),
      variables: { monthlyLateOccurrence: 3, incidentDate: '2026-08-05' },
      requiresAcknowledgement: true,
    };
    const { tx, getPayrollEntries, getDeductions } = makeFreezeFakeTx({
      stipendRecords: [singleSr],
      payrollEntries: [entry],
      deductions: [deduction],
      letters: [letter],
    });

    const result = await reverseLateDisciplineForDate(tx, EMP_ID, FINE_INCIDENT_DATE);

    expect(result.reversed).toBe(true); // letter/DisciplineEvent side still reversed
    expect(result.deductionReversed).toBe(false);
    expect(result.blockedByPayrollStatus).toBe(true);
    expect(getDeductions()).toHaveLength(1); // untouched
    expect(getPayrollEntries()[0].totalDeductions).toBe(800); // untouched
  });

  // 9. Late reversal on PAID does not mutate financial rows.
  it('9: reversing a FINE on a PAID entry leaves the deduction and totals untouched', async () => {
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
      reason: 'LATE_ARRIVAL',
      amount: 800,
      description: 'Late arrival deduction — monthly occurrence 3',
    };
    const letter: FakeLetter = {
      id: 'letter-1',
      letterType: LetterType.FINE,
      generatedAt: new Date('2026-08-05T00:00:00.000Z'),
      variables: { monthlyLateOccurrence: 3, incidentDate: '2026-08-05' },
      requiresAcknowledgement: true,
    };
    const { tx, getPayrollEntries, getDeductions } = makeFreezeFakeTx({
      stipendRecords: [singleSr],
      payrollEntries: [entry],
      deductions: [deduction],
      letters: [letter],
    });

    const result = await reverseLateDisciplineForDate(tx, EMP_ID, FINE_INCIDENT_DATE);

    expect(result.reversed).toBe(true);
    expect(result.deductionReversed).toBe(false);
    expect(result.blockedByPayrollStatus).toBe(true);
    expect(getDeductions()).toHaveLength(1);
    expect(getPayrollEntries()[0].totalDeductions).toBe(800);
  });

  // 10. DisciplineEvent / letters remain behaviorally consistent with
  // existing policy: the incident is still tracked (claimed) and the FINE
  // letter is still issued even though the financial mutation is frozen —
  // the freeze only blocks money, never the disciplinary record.
  it('10: DisciplineEvent is still claimed and the FINE letter is still issued when the target entry is frozen', async () => {
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
      priorLateDates: FINE_PRIOR_DATES,
    });

    await applyDisciplineRules(tx, EMP_ID, AttendanceStatus.LATE, FINE_INCIDENT_DATE, {
      lateMinutes: 30,
    });

    expect(getDisciplineEvents()).toHaveLength(1); // incident still tracked
    expect(issueAutoTemplatedLetterMock).toHaveBeenCalledTimes(1); // FINE letter still issued
    const call = issueAutoTemplatedLetterMock.mock.calls[0][1];
    expect(call.letterType).toBe(LetterType.FINE);

    // A replay of the exact same incident is still idempotent (no second
    // DisciplineEvent, no second letter call) even though it's frozen.
    await applyDisciplineRules(tx, EMP_ID, AttendanceStatus.LATE, FINE_INCIDENT_DATE, {
      lateMinutes: 30,
    });
    expect(getDisciplineEvents()).toHaveLength(1);
    expect(issueAutoTemplatedLetterMock).toHaveBeenCalledTimes(1);
  });
});
