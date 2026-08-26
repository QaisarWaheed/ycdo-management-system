import { AttendanceStatus, Prisma } from '@prisma/client';

// discipline.helper.ts imports issueAutoTemplatedLetter at module scope,
// which transitively pulls in puppeteer (ESM-only, breaks Jest's default
// CommonJS transform). Stub the module boundary — same pattern as the
// other two discipline specs in this directory.
jest.mock('./../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));

import {
  isUninformedAbsentEligibleForDiscipline,
  reverseAbsenceDeductionForDate,
} from './discipline.helper';

const EMPLOYEE_ID = 'emp-ua-1';
const OTHER_EMPLOYEE_ID = 'emp-ua-2';

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
 * In-memory Prisma.TransactionClient stand-in covering exactly what
 * reverseAbsenceDeductionForDate reads/writes. `ownerEmployeeId` models
 * which employee the mocked stipendRecord/payrollEntry actually belongs to
 * — stipendRecord.findFirst only ever "finds" a record when called with
 * that exact employeeId, faithfully reproducing the real employee-scoping
 * the production query performs.
 */
function makeAbsenceFakeTx(seed: {
  ownerEmployeeId: string;
  payrollEntry: FakePayrollEntry | null;
  deductions: FakeDeduction[];
  disciplineEvents: { id: string; category: string; incidentDate: string }[];
}) {
  const { ownerEmployeeId } = seed;
  const payrollEntry = seed.payrollEntry;
  let deductions = seed.deductions;
  let disciplineEvents = seed.disciplineEvents;

  const tx = {
    stipendRecord: {
      findFirst: jest.fn(({ where }: { where: { employeeId: string } }) =>
        where.employeeId === ownerEmployeeId && payrollEntry
          ? { id: 'stipend-1' }
          : null,
      ),
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
            description: { in: string[] };
          };
        }) =>
          deductions.find(
            (d) =>
              d.payrollEntryId === where.payrollEntryId &&
              d.reason === where.reason &&
              where.description.in.includes(d.description),
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
                e.incidentDate === incidentDateIso &&
                where.employeeId === ownerEmployeeId
              ),
          );
          return { count: before - disciplineEvents.length };
        },
      ),
    },
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    getState: () => ({ payrollEntry, deductions, disciplineEvents }),
  };
}

function pendingScenario(overrides?: {
  payrollStatus?: 'PENDING' | 'PROCESSED' | 'PAID';
}) {
  return makeAbsenceFakeTx({
    ownerEmployeeId: EMPLOYEE_ID,
    payrollEntry: {
      id: 'pe-1',
      status: overrides?.payrollStatus ?? 'PENDING',
      totalDeductions: 5000,
      netStipend: 25000,
    },
    deductions: [
      {
        id: 'ded-ua-1',
        payrollEntryId: 'pe-1',
        reason: 'UNINFORMED_ABSENCE',
        amount: 1937.5,
        description: 'Uninformed absence deduction (2 days) — 2026-08-18',
      },
    ],
    disciplineEvents: [
      {
        id: 'de-ua-1',
        category: 'UNINFORMED_ABSENT',
        incidentDate: '2026-08-18',
      },
    ],
  });
}

describe('isUninformedAbsentEligibleForDiscipline', () => {
  it('UNINFORMED_ABSENT is eligible', () => {
    expect(
      isUninformedAbsentEligibleForDiscipline({
        status: AttendanceStatus.UNINFORMED_ABSENT,
      }),
    ).toBe(true);
  });

  it.each([
    AttendanceStatus.PRESENT,
    AttendanceStatus.LATE,
    AttendanceStatus.HALF_DAY,
    AttendanceStatus.ON_LEAVE,
    AttendanceStatus.SHORT_LEAVE,
    AttendanceStatus.ABSENT,
    AttendanceStatus.SWAP_COVERED,
    AttendanceStatus.UNMARKED,
  ])('%s is NOT eligible', (status) => {
    expect(isUninformedAbsentEligibleForDiscipline({ status })).toBe(false);
  });
});

describe('gating expression used by updateAttendance/markManual (before-eligible && !after-eligible)', () => {
  function shouldReverse(before: AttendanceStatus, after: AttendanceStatus) {
    return (
      isUninformedAbsentEligibleForDiscipline({ status: before }) &&
      !isUninformedAbsentEligibleForDiscipline({ status: after })
    );
  }

  it('Scenario A/H/I: UNINFORMED_ABSENT -> PRESENT triggers reversal', () => {
    expect(
      shouldReverse(
        AttendanceStatus.UNINFORMED_ABSENT,
        AttendanceStatus.PRESENT,
      ),
    ).toBe(true);
  });
  it('Scenario B: UNINFORMED_ABSENT -> LATE triggers reversal', () => {
    expect(
      shouldReverse(AttendanceStatus.UNINFORMED_ABSENT, AttendanceStatus.LATE),
    ).toBe(true);
  });
  it('Scenario C: UNINFORMED_ABSENT -> HALF_DAY triggers reversal', () => {
    expect(
      shouldReverse(
        AttendanceStatus.UNINFORMED_ABSENT,
        AttendanceStatus.HALF_DAY,
      ),
    ).toBe(true);
  });
  it('Scenario D: UNINFORMED_ABSENT -> ON_LEAVE triggers reversal', () => {
    expect(
      shouldReverse(
        AttendanceStatus.UNINFORMED_ABSENT,
        AttendanceStatus.ON_LEAVE,
      ),
    ).toBe(true);
  });
  it('Scenario E: UNINFORMED_ABSENT -> SWAP_COVERED triggers reversal', () => {
    expect(
      shouldReverse(
        AttendanceStatus.UNINFORMED_ABSENT,
        AttendanceStatus.SWAP_COVERED,
      ),
    ).toBe(true);
  });
  it('Scenario F: UNINFORMED_ABSENT -> UNINFORMED_ABSENT does NOT trigger reversal', () => {
    expect(
      shouldReverse(
        AttendanceStatus.UNINFORMED_ABSENT,
        AttendanceStatus.UNINFORMED_ABSENT,
      ),
    ).toBe(false);
  });
  it('Scenario G: PRESENT -> PRESENT does NOT trigger reversal', () => {
    expect(
      shouldReverse(AttendanceStatus.PRESENT, AttendanceStatus.PRESENT),
    ).toBe(false);
  });
  it('mutually exclusive with the LATE gate: never true for a LATE->PRESENT transition', () => {
    // The LATE gate (isLateEligibleForDiscipline) is what fires here instead
    // — this predicate must stay false since the row was never UNINFORMED_ABSENT.
    expect(shouldReverse(AttendanceStatus.LATE, AttendanceStatus.PRESENT)).toBe(
      false,
    );
  });
});

describe('reverseAbsenceDeductionForDate', () => {
  it('Scenario A: PENDING payroll — deduction reversed, totals restored, DisciplineEvent removed', async () => {
    const { tx, getState } = pendingScenario();

    const result = await reverseAbsenceDeductionForDate(
      tx,
      EMPLOYEE_ID,
      new Date('2026-08-18T00:00:00.000Z'),
    );

    expect(result.reversed).toBe(true);
    expect(result.deductionReversed).toBe(true);
    expect(result.deductionAmount).toBe(1937.5);
    expect(result.blockedByPayrollStatus).toBe(false);
    expect(result.disciplineEventRemoved).toBe(true);

    const state = getState();
    expect(state.deductions).toHaveLength(0);
    expect(state.payrollEntry?.totalDeductions).toBeCloseTo(5000 - 1937.5);
    expect(state.payrollEntry?.netStipend).toBeCloseTo(25000 + 1937.5);
    expect(state.disciplineEvents).toHaveLength(0);
  });

  it('Scenario H: PROCESSED payroll — deduction stays frozen, DisciplineEvent is released', async () => {
    const { tx, getState } = pendingScenario({ payrollStatus: 'PROCESSED' });

    const result = await reverseAbsenceDeductionForDate(
      tx,
      EMPLOYEE_ID,
      new Date('2026-08-18T00:00:00.000Z'),
    );

    expect(result.deductionReversed).toBe(false);
    expect(result.blockedByPayrollStatus).toBe(true);
    expect(result.payrollStatus).toBe('PROCESSED');
    expect(result.disciplineEventRemoved).toBe(true);

    const state = getState();
    expect(state.deductions).toHaveLength(1);
    expect(state.disciplineEvents).toHaveLength(0);
  });

  it('Scenario I: PAID payroll behaves the same as PROCESSED', async () => {
    const { tx, getState } = pendingScenario({ payrollStatus: 'PAID' });

    const result = await reverseAbsenceDeductionForDate(
      tx,
      EMPLOYEE_ID,
      new Date('2026-08-18T00:00:00.000Z'),
    );

    expect(result.blockedByPayrollStatus).toBe(true);
    expect(getState().deductions).toHaveLength(1);
  });

  it('Scenario J: repeated identical correction is idempotent — no double credit, no error', async () => {
    const { tx, getState } = pendingScenario();
    const date = new Date('2026-08-18T00:00:00.000Z');

    const first = await reverseAbsenceDeductionForDate(tx, EMPLOYEE_ID, date);
    const afterFirst = { ...getState().payrollEntry };

    const second = await reverseAbsenceDeductionForDate(tx, EMPLOYEE_ID, date);
    const afterSecond = getState().payrollEntry;

    expect(first.deductionReversed).toBe(true);
    expect(second.deductionReversed).toBe(false); // deduction already gone
    expect(second.disciplineEventRemoved).toBe(false); // event already gone
    expect(afterSecond?.totalDeductions).toBe(afterFirst.totalDeductions); // no double credit
    expect(afterSecond?.netStipend).toBe(afterFirst.netStipend);
    expect(afterSecond?.totalDeductions).toBeGreaterThanOrEqual(0); // no negative totals
  });

  it('Scenario K: legacy undated UA deduction is never guessed/reversed by exact-date correction', async () => {
    const { tx, getState } = makeAbsenceFakeTx({
      ownerEmployeeId: EMPLOYEE_ID,
      payrollEntry: {
        id: 'pe-1',
        status: 'PENDING',
        totalDeductions: 5000,
        netStipend: 25000,
      },
      deductions: [
        {
          id: 'ded-legacy-1',
          payrollEntryId: 'pe-1',
          reason: 'UNINFORMED_ABSENCE',
          amount: 1937.5,
          description: 'Uninformed absence deduction (2 days)', // no date suffix
        },
      ],
      disciplineEvents: [],
    });

    const result = await reverseAbsenceDeductionForDate(
      tx,
      EMPLOYEE_ID,
      new Date('2026-08-18T00:00:00.000Z'),
    );

    expect(result.deductionReversed).toBe(false);
    expect(result.deductionId).toBeNull();
    expect(getState().deductions).toHaveLength(1); // untouched
    expect(getState().payrollEntry?.totalDeductions).toBe(5000); // untouched
  });

  it("Scenario L: another employee's same-date UA deduction is never touched", async () => {
    // stipendRecord.findFirst only "finds" a record for the OTHER employee —
    // calling with EMPLOYEE_ID must find nothing, proving cross-employee isolation.
    const { tx, getState } = makeAbsenceFakeTx({
      ownerEmployeeId: OTHER_EMPLOYEE_ID,
      payrollEntry: {
        id: 'pe-other',
        status: 'PENDING',
        totalDeductions: 5000,
        netStipend: 25000,
      },
      deductions: [
        {
          id: 'ded-other-employee',
          payrollEntryId: 'pe-other',
          reason: 'UNINFORMED_ABSENCE',
          amount: 1937.5,
          description: 'Uninformed absence deduction (2 days) — 2026-08-18',
        },
      ],
      disciplineEvents: [],
    });

    const result = await reverseAbsenceDeductionForDate(
      tx,
      EMPLOYEE_ID,
      new Date('2026-08-18T00:00:00.000Z'),
    );

    expect(result.deductionReversed).toBe(false);
    expect(result.deductionId).toBeNull();
    expect(getState().deductions).toHaveLength(1); // the other employee's row, untouched
    expect(getState().payrollEntry?.totalDeductions).toBe(5000);
  });

  it('Scenario M: wrong incident date for the SAME employee is never touched', async () => {
    const { tx, getState } = makeAbsenceFakeTx({
      ownerEmployeeId: EMPLOYEE_ID,
      payrollEntry: {
        id: 'pe-1',
        status: 'PENDING',
        totalDeductions: 5000,
        netStipend: 25000,
      },
      deductions: [
        {
          id: 'ded-different-date',
          payrollEntryId: 'pe-1',
          reason: 'UNINFORMED_ABSENCE',
          amount: 1937.5,
          description: 'Uninformed absence deduction (2 days) — 2026-08-05', // different date
        },
      ],
      disciplineEvents: [
        {
          id: 'de-different-date',
          category: 'UNINFORMED_ABSENT',
          incidentDate: '2026-08-05',
        },
      ],
    });

    // Correcting Aug 18 must never touch the Aug 5 deduction/event.
    const result = await reverseAbsenceDeductionForDate(
      tx,
      EMPLOYEE_ID,
      new Date('2026-08-18T00:00:00.000Z'),
    );

    expect(result.deductionReversed).toBe(false);
    expect(result.disciplineEventRemoved).toBe(false);
    expect(getState().deductions).toHaveLength(1);
    expect(getState().disciplineEvents).toHaveLength(1);
  });

  it('Scenario D-adjacent: no double reversal risk with the leave-approval caller — idempotent across repeated calls from different callers', async () => {
    // Simulates updateAttendance's own reversal call landing right after
    // (or before) the leave-approval flow's own call for the SAME date —
    // both call the exact same function, so this is really Scenario J
    // again from a different caller's perspective; asserting it explicitly
    // here documents that no separate "double reversal with leave logic"
    // path exists to worry about.
    const { tx, getState } = pendingScenario();
    const date = new Date('2026-08-18T00:00:00.000Z');

    await reverseAbsenceDeductionForDate(tx, EMPLOYEE_ID, date); // e.g. leave-approval flow
    const afterLeaveApproval = { ...getState().payrollEntry };
    await reverseAbsenceDeductionForDate(tx, EMPLOYEE_ID, date); // e.g. updateAttendance's own call

    const afterBoth = getState().payrollEntry;
    expect(afterBoth?.totalDeductions).toBe(afterLeaveApproval.totalDeductions);
    expect(afterBoth?.netStipend).toBe(afterLeaveApproval.netStipend);
  });
});
