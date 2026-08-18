import { AttendanceStatus, LetterType, Prisma } from '@prisma/client';

// reverseLateDisciplineForDate never calls issueAutoTemplatedLetter itself,
// but discipline.helper.ts imports it at module scope, which transitively
// pulls in pdf.helper.ts -> puppeteer (an ESM-only package Jest's default
// CommonJS transform can't parse). Stubbing the module boundary avoids that
// import chain entirely — same pattern as discipline-idempotency.spec.ts.
jest.mock('./../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));

import {
  isLateEligibleForDiscipline,
  reverseLateDisciplineForDate,
} from './discipline.helper';

const EMPLOYEE_ID = 'emp-1';

type FakeLetter = {
  id: string;
  letterType: LetterType;
  generatedAt: Date;
  variables: Record<string, unknown>;
  requiresAcknowledgement: boolean;
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
  status: 'PENDING' | 'PROCESSED' | 'PAID';
  totalDeductions: number;
  netStipend: number;
};

/**
 * Minimal in-memory store covering exactly what reverseLateDisciplineForDate
 * reads/writes: letters, a single payroll entry + its deductions, and
 * disciplineEvent rows. Mutations are real (not just recorded), so a second
 * call against the SAME store genuinely exercises idempotency rather than
 * asserting on call counts alone.
 */
function makeFakeTx(seed: {
  letters: FakeLetter[];
  payrollEntry: FakePayrollEntry | null;
  deductions: FakeDeduction[];
  disciplineEvents: {
    id: string;
    category: string;
    incidentDate: string;
    occurrence: number;
  }[];
}) {
  const letters = seed.letters;
  const payrollEntry = seed.payrollEntry;
  let deductions = seed.deductions;
  let disciplineEvents = seed.disciplineEvents;

  const tx = {
    letter: {
      findMany: jest.fn(() => letters),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: {
            variables: Record<string, unknown>;
            requiresAcknowledgement?: boolean;
          };
        }) => {
          const letter = letters.find((l) => l.id === where.id);
          if (!letter) throw new Error('letter not found');
          letter.variables = data.variables;
          if (data.requiresAcknowledgement !== undefined) {
            letter.requiresAcknowledgement = data.requiresAcknowledgement;
          }
          return letter;
        },
      ),
    },
    stipendRecord: {
      findFirst: jest.fn(() => (payrollEntry ? { id: 'stipend-1' } : null)),
    },
    payrollEntry: {
      findUnique: jest.fn(() => payrollEntry),
      update: jest.fn(
        ({
          data,
        }: {
          data: {
            totalDeductions?: { decrement: number };
            netStipend?: { increment: number };
          };
        }) => {
          if (!payrollEntry) throw new Error('no entry');
          if (data.totalDeductions?.decrement != null) {
            payrollEntry.totalDeductions -= data.totalDeductions.decrement;
          }
          if (data.netStipend?.increment != null) {
            payrollEntry.netStipend += data.netStipend.increment;
          }
          return payrollEntry;
        },
      ),
    },
    payrollDeduction: {
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: {
            payrollEntryId: string;
            reason: string;
            description: string;
          };
        }) =>
          deductions.find(
            (d) =>
              d.payrollEntryId === where.payrollEntryId &&
              d.reason === where.reason &&
              d.description === where.description,
          ) ?? null,
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        const before = deductions.length;
        deductions = deductions.filter((d) => d.id !== where.id);
        if (deductions.length === before)
          throw new Error('deduction not found');
      }),
    },
    disciplineEvent: {
      deleteMany: jest.fn(
        ({
          where,
        }: {
          where: { employeeId: string; category: string; incidentDate: Date };
        }) => {
          const incidentDateIso = where.incidentDate.toISOString().slice(0, 10);
          const before = disciplineEvents.length;
          disciplineEvents = disciplineEvents.filter(
            (e) =>
              !(
                e.category === where.category &&
                e.incidentDate === incidentDateIso
              ),
          );
          return { count: before - disciplineEvents.length };
        },
      ),
    },
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    getState: () => ({ letters, payrollEntry, deductions, disciplineEvents }),
  };
}

function fineScenario(overrides?: {
  payrollStatus?: 'PENDING' | 'PROCESSED' | 'PAID';
}) {
  return makeFakeTx({
    letters: [
      {
        id: 'letter-fine-1',
        letterType: LetterType.FINE,
        generatedAt: new Date('2026-08-18T10:52:48.554Z'),
        variables: { incidentDate: '2026-08-18', monthlyLateOccurrence: 3 },
        requiresAcknowledgement: true,
      },
    ],
    payrollEntry: {
      id: 'payroll-entry-1',
      status: overrides?.payrollStatus ?? 'PENDING',
      totalDeductions: 5000,
      netStipend: 25000,
    },
    deductions: [
      {
        id: 'deduction-1',
        payrollEntryId: 'payroll-entry-1',
        reason: 'LATE_ARRIVAL',
        amount: 1774.19,
        description: 'Late arrival deduction — monthly occurrence 3',
      },
    ],
    disciplineEvents: [
      {
        id: 'de-1',
        category: 'LATE',
        incidentDate: '2026-08-18',
        occurrence: 3,
      },
    ],
  });
}

describe('isLateEligibleForDiscipline', () => {
  it('LATE is eligible', () => {
    expect(
      isLateEligibleForDiscipline({
        status: AttendanceStatus.LATE,
        lateMinutes: 20,
        note: null,
      }),
    ).toBe(true);
  });
  it('lateness-driven HALF_DAY (lateMinutes > 0, no short-leave note) is eligible', () => {
    expect(
      isLateEligibleForDiscipline({
        status: AttendanceStatus.HALF_DAY,
        lateMinutes: 240,
        note: null,
      }),
    ).toBe(true);
  });
  it('HALF_DAY with a short-leave note is NOT eligible', () => {
    expect(
      isLateEligibleForDiscipline({
        status: AttendanceStatus.HALF_DAY,
        lateMinutes: 90,
        note: 'Short Leave approved',
      }),
    ).toBe(false);
  });
  it('HALF_DAY with zero lateMinutes is NOT eligible', () => {
    expect(
      isLateEligibleForDiscipline({
        status: AttendanceStatus.HALF_DAY,
        lateMinutes: 0,
        note: null,
      }),
    ).toBe(false);
  });
  it.each([
    AttendanceStatus.PRESENT,
    AttendanceStatus.ON_LEAVE,
    AttendanceStatus.SHORT_LEAVE,
    AttendanceStatus.ABSENT,
    AttendanceStatus.UNINFORMED_ABSENT,
  ])('%s is NOT eligible', (status) => {
    expect(
      isLateEligibleForDiscipline({ status, lateMinutes: 0, note: null }),
    ).toBe(false);
  });
});

describe('gating expression used by updateAttendance/markManual (before-eligible && !after-eligible)', () => {
  function shouldReverse(
    before: {
      status: AttendanceStatus;
      lateMinutes: number;
      note: string | null;
    },
    after: typeof before,
  ) {
    return (
      isLateEligibleForDiscipline(before) && !isLateEligibleForDiscipline(after)
    );
  }

  it('Scenario 1: HALF_DAY(late) -> PRESENT triggers reversal', () => {
    expect(
      shouldReverse(
        { status: AttendanceStatus.HALF_DAY, lateMinutes: 240, note: null },
        { status: AttendanceStatus.PRESENT, lateMinutes: 0, note: null },
      ),
    ).toBe(true);
  });

  it('Scenario 2: LATE -> PRESENT triggers reversal', () => {
    expect(
      shouldReverse(
        { status: AttendanceStatus.LATE, lateMinutes: 30, note: null },
        { status: AttendanceStatus.PRESENT, lateMinutes: 0, note: null },
      ),
    ).toBe(true);
  });

  it('Scenario 3: LATE -> ON_LEAVE triggers reversal', () => {
    expect(
      shouldReverse(
        { status: AttendanceStatus.LATE, lateMinutes: 30, note: null },
        { status: AttendanceStatus.ON_LEAVE, lateMinutes: 0, note: null },
      ),
    ).toBe(true);
  });

  it('Scenario 4: LATE -> SHORT_LEAVE triggers reversal', () => {
    expect(
      shouldReverse(
        { status: AttendanceStatus.LATE, lateMinutes: 30, note: null },
        { status: AttendanceStatus.SHORT_LEAVE, lateMinutes: 0, note: null },
      ),
    ).toBe(true);
  });

  it('Scenario 5: LATE -> LATE does NOT trigger reversal', () => {
    expect(
      shouldReverse(
        { status: AttendanceStatus.LATE, lateMinutes: 20, note: null },
        { status: AttendanceStatus.LATE, lateMinutes: 35, note: null },
      ),
    ).toBe(false);
  });

  it('Scenario 5b: lateness HALF_DAY -> another lateness HALF_DAY does NOT trigger reversal', () => {
    expect(
      shouldReverse(
        { status: AttendanceStatus.HALF_DAY, lateMinutes: 200, note: null },
        { status: AttendanceStatus.HALF_DAY, lateMinutes: 250, note: null },
      ),
    ).toBe(false);
  });

  it('Scenario 6: PRESENT -> PRESENT does NOT trigger reversal', () => {
    expect(
      shouldReverse(
        { status: AttendanceStatus.PRESENT, lateMinutes: 0, note: null },
        { status: AttendanceStatus.PRESENT, lateMinutes: 0, note: null },
      ),
    ).toBe(false);
  });

  it('Scenario 7: checkOut-only update on a LATE row (status/lateMinutes/note unchanged) does NOT trigger reversal', () => {
    const before = {
      status: AttendanceStatus.LATE,
      lateMinutes: 20,
      note: null,
    };
    const after = {
      status: AttendanceStatus.LATE,
      lateMinutes: 20,
      note: null,
    }; // checkOut is not part of eligibility at all
    expect(shouldReverse(before, after)).toBe(false);
  });
});

describe('reverseLateDisciplineForDate', () => {
  it('Scenario 1/2: reverses the FINE letter, deletes the matching deduction, restores totals, removes the DisciplineEvent', async () => {
    const { tx, getState } = fineScenario();

    const result = await reverseLateDisciplineForDate(
      tx,
      EMPLOYEE_ID,
      new Date('2026-08-18T00:00:00.000Z'),
    );

    expect(result.reversed).toBe(true);
    expect(result.deductionReversed).toBe(true);
    expect(result.deductionAmount).toBe(1774.19);
    expect(result.blockedByPayrollStatus).toBe(false);
    expect(result.disciplineEventRemoved).toBe(true);

    const state = getState();
    expect(state.deductions).toHaveLength(0);
    expect(state.payrollEntry?.totalDeductions).toBeCloseTo(5000 - 1774.19);
    expect(state.payrollEntry?.netStipend).toBeCloseTo(25000 + 1774.19);
    expect(state.disciplineEvents).toHaveLength(0);
    expect(state.letters[0].variables.reversedDueToShortLeave).toBe(true);
    expect(state.letters[0].requiresAcknowledgement).toBe(false);
  });

  it('Scenario 3/4: an ADVICE/WARNING-only date (no deduction) is reversed with no payroll interaction', async () => {
    const { tx, getState } = makeFakeTx({
      letters: [
        {
          id: 'letter-advice-1',
          letterType: LetterType.ADVICE,
          generatedAt: new Date('2026-08-13T09:00:00.000Z'),
          variables: { incidentDate: '2026-08-13', monthlyLateOccurrence: 1 },
          requiresAcknowledgement: true,
        },
      ],
      payrollEntry: null,
      deductions: [],
      disciplineEvents: [
        {
          id: 'de-0',
          category: 'LATE',
          incidentDate: '2026-08-13',
          occurrence: 1,
        },
      ],
    });

    const result = await reverseLateDisciplineForDate(
      tx,
      EMPLOYEE_ID,
      new Date('2026-08-13T00:00:00.000Z'),
    );

    expect(result.reversed).toBe(true);
    expect(result.deductionReversed).toBe(false);
    expect(result.disciplineEventRemoved).toBe(true);
    expect(getState().letters[0].variables.reversedDueToShortLeave).toBe(true);
  });

  it('Scenario 8: calling reversal twice is idempotent — no double credit, no error', async () => {
    const { tx, getState } = fineScenario();
    const date = new Date('2026-08-18T00:00:00.000Z');

    const first = await reverseLateDisciplineForDate(tx, EMPLOYEE_ID, date);
    const stateAfterFirst = { ...getState().payrollEntry };

    const second = await reverseLateDisciplineForDate(tx, EMPLOYEE_ID, date);
    const stateAfterSecond = getState().payrollEntry;

    expect(first.reversed).toBe(true);
    expect(second.reversed).toBe(false); // no active letter found — pure no-op
    expect(second.deductionReversed).toBe(false);
    expect(stateAfterSecond?.totalDeductions).toBe(
      stateAfterFirst.totalDeductions,
    ); // no double credit
    expect(stateAfterSecond?.netStipend).toBe(stateAfterFirst.netStipend);
  });

  it('Scenario 9: PROCESSED payroll entry — deduction/totals untouched, letter and DisciplineEvent still reversed', async () => {
    const { tx, getState } = fineScenario({ payrollStatus: 'PROCESSED' });

    const result = await reverseLateDisciplineForDate(
      tx,
      EMPLOYEE_ID,
      new Date('2026-08-18T00:00:00.000Z'),
    );

    expect(result.reversed).toBe(true);
    expect(result.deductionReversed).toBe(false);
    expect(result.blockedByPayrollStatus).toBe(true);
    expect(result.payrollStatus).toBe('PROCESSED');

    const state = getState();
    expect(state.deductions).toHaveLength(1); // untouched
    expect(state.payrollEntry?.totalDeductions).toBe(5000); // untouched
    expect(state.payrollEntry?.netStipend).toBe(25000); // untouched
    expect(state.disciplineEvents).toHaveLength(0); // still released
    expect(state.letters[0].variables.reversedDueToShortLeave).toBe(true); // still reversed
  });

  it('Scenario 9b: PAID payroll entry behaves the same as PROCESSED', async () => {
    const { tx, getState } = fineScenario({ payrollStatus: 'PAID' });

    const result = await reverseLateDisciplineForDate(
      tx,
      EMPLOYEE_ID,
      new Date('2026-08-18T00:00:00.000Z'),
    );

    expect(result.blockedByPayrollStatus).toBe(true);
    expect(getState().deductions).toHaveLength(1);
  });

  it("Scenario 10: occurrence-3 (Aug13 occ1, Aug14 occ2, Aug18 occ3 Fine) — reversing Aug18 only touches Aug18's own letter/deduction/event", async () => {
    const { tx, getState } = makeFakeTx({
      letters: [
        {
          id: 'letter-occ1',
          letterType: LetterType.ADVICE,
          generatedAt: new Date('2026-08-13T09:00:00.000Z'),
          variables: { incidentDate: '2026-08-13', monthlyLateOccurrence: 1 },
          requiresAcknowledgement: true,
        },
        {
          id: 'letter-occ2',
          letterType: LetterType.WARNING,
          generatedAt: new Date('2026-08-14T09:00:00.000Z'),
          variables: { incidentDate: '2026-08-14', monthlyLateOccurrence: 2 },
          requiresAcknowledgement: true,
        },
        {
          id: 'letter-occ3',
          letterType: LetterType.FINE,
          generatedAt: new Date('2026-08-18T10:52:48.554Z'),
          variables: { incidentDate: '2026-08-18', monthlyLateOccurrence: 3 },
          requiresAcknowledgement: true,
        },
      ],
      payrollEntry: {
        id: 'payroll-entry-1',
        status: 'PENDING',
        totalDeductions: 1774.19,
        netStipend: 28225.81,
      },
      deductions: [
        {
          id: 'deduction-occ3',
          payrollEntryId: 'payroll-entry-1',
          reason: 'LATE_ARRIVAL',
          amount: 1774.19,
          description: 'Late arrival deduction — monthly occurrence 3',
        },
      ],
      disciplineEvents: [
        {
          id: 'de-1',
          category: 'LATE',
          incidentDate: '2026-08-13',
          occurrence: 1,
        },
        {
          id: 'de-2',
          category: 'LATE',
          incidentDate: '2026-08-14',
          occurrence: 2,
        },
        {
          id: 'de-3',
          category: 'LATE',
          incidentDate: '2026-08-18',
          occurrence: 3,
        },
      ],
    });

    const result = await reverseLateDisciplineForDate(
      tx,
      EMPLOYEE_ID,
      new Date('2026-08-18T00:00:00.000Z'),
    );

    expect(result.reversed).toBe(true);
    expect(result.deductionReversed).toBe(true);

    const state = getState();
    // Aug18's own consequences are gone.
    expect(state.deductions).toHaveLength(0);
    expect(state.payrollEntry?.totalDeductions).toBeCloseTo(0);
    expect(
      state.disciplineEvents.find((e) => e.incidentDate === '2026-08-18'),
    ).toBeUndefined();
    expect(
      state.letters.find((l) => l.id === 'letter-occ3')?.variables
        .reversedDueToShortLeave,
    ).toBe(true);
    // Aug13/Aug14's own letters and DisciplineEvents are completely untouched
    // — this fix deliberately does NOT renumber/reissue other dates.
    expect(
      state.disciplineEvents.find((e) => e.incidentDate === '2026-08-13'),
    ).toBeDefined();
    expect(
      state.disciplineEvents.find((e) => e.incidentDate === '2026-08-14'),
    ).toBeDefined();
    expect(
      state.letters.find((l) => l.id === 'letter-occ1')?.variables
        .reversedDueToShortLeave,
    ).toBeUndefined();
    expect(
      state.letters.find((l) => l.id === 'letter-occ2')?.variables
        .reversedDueToShortLeave,
    ).toBeUndefined();
  });
});
