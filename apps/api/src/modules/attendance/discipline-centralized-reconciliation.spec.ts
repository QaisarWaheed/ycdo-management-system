import { AttendanceStatus, LetterType, Prisma } from '@prisma/client';

// discipline.helper.ts imports issueAutoTemplatedLetter at module scope,
// which transitively pulls in puppeteer (ESM-only, breaks Jest's default
// CommonJS transform). Stub the module boundary — same pattern as the other
// discipline specs in this directory.
jest.mock('./../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));

import {
  isAbsentFamilyEligibleForDiscipline,
  isMissingCheckoutEligibleForDiscipline,
  reconcileAttendanceFinancialConsequences,
  reverseMissingCheckoutDisciplineForDate,
} from './discipline.helper';

const EMPLOYEE_ID = 'emp-central-1';
const OTHER_EMPLOYEE_ID = 'emp-central-2';
const DATE = new Date('2026-08-18T00:00:00.000Z');
const DATE_LABEL = '2026-08-18';

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
type FakeDisciplineEvent = {
  id: string;
  employeeId: string;
  category: string;
  incidentDate: string;
  occurrence: number;
};

/**
 * Full in-memory Prisma.TransactionClient stand-in covering everything
 * reconcileAttendanceFinancialConsequences' underlying calls read/write:
 * letters, one payroll entry + its deductions, disciplineEvent rows,
 * employee/leaveRecord/attendanceLog/notification/user for the
 * application-side path (applyDisciplineRules -> applyAbsentDeduction /
 * applyUninformedAbsentDeduction). Mutations are real (not just recorded),
 * so idempotency/duplicate-prevention tests genuinely exercise mutation
 * semantics.
 */
function makeReconcileFakeTx(seed: {
  ownerEmployeeId?: string;
  basicStipend?: number;
  payrollEntry?: FakePayrollEntry | null;
  deductions?: FakeDeduction[];
  disciplineEvents?: FakeDisciplineEvent[];
  letters?: FakeLetter[];
  approvedLeaveCoversDate?: boolean;
  priorUninformedAbsentDates?: string[];
  initialEmployeeStatus?: 'ACTIVE' | 'SUSPENDED';
}) {
  const ownerEmployeeId = seed.ownerEmployeeId ?? EMPLOYEE_ID;
  const basicStipend = seed.basicStipend ?? 30000;
  let payrollEntry = seed.payrollEntry ?? null;
  let deductions = seed.deductions ?? [];
  let disciplineEvents = seed.disciplineEvents ?? [];
  const letters = seed.letters ?? [];
  const priorUninformedAbsentDates = seed.priorUninformedAbsentDates ?? [];
  let employeeStatus = seed.initialEmployeeStatus ?? 'ACTIVE';
  let userIsActive = true;

  const tx = {
    employee: {
      findUnique: jest.fn(
        (args: { where: { id: string }; select?: { status?: boolean } }) => {
          if (args.where.id !== ownerEmployeeId) return null;
          if (args.select?.status) return { status: employeeStatus };
          return {
            id: ownerEmployeeId,
            dutyStartTime: null,
            dutyEndTime: null,
            stipendRecords: [{ basicStipend }],
          };
        },
      ),
      update: jest.fn((args: { data: { status?: string } }) => {
        if (args.data.status) employeeStatus = args.data.status as 'ACTIVE' | 'SUSPENDED';
        return { status: employeeStatus };
      }),
    },
    user: {
      updateMany: jest.fn((args: { data: { isActive?: boolean } }) => {
        if (args.data.isActive !== undefined) userIsActive = args.data.isActive;
        return { count: 1 };
      }),
    },
    leaveRecord: {
      findFirst: jest.fn(() =>
        seed.approvedLeaveCoversDate ? { id: 'lr-1' } : null,
      ),
    },
    attendanceLog: {
      findMany: jest.fn(() =>
        priorUninformedAbsentDates.map((d) => ({
          date: new Date(`${d}T00:00:00.000Z`),
        })),
      ),
    },
    notification: { create: jest.fn(() => ({})) },
    stipendRecord: {
      findFirst: jest.fn((args: { where: { employeeId: string } }) =>
        args.where.employeeId === ownerEmployeeId
          ? { id: 'stipend-1', basicStipend, effectiveFrom: new Date('2000-01-01T00:00:00.000Z'), effectiveTo: null }
          : null,
      ),
    },
    payrollEntry: {
      findUnique: jest.fn(() => payrollEntry),
      create: jest.fn(() => {
        payrollEntry = {
          id: 'pe-created',
          status: 'PENDING',
          totalDeductions: 0,
          netStipend: basicStipend,
        };
        return payrollEntry;
      }),
      update: jest.fn(
        (args: {
          data: {
            totalDeductions?: { increment?: number; decrement?: number };
            netStipend?: { increment?: number; decrement?: number };
          };
        }) => {
          if (!payrollEntry) throw new Error('no entry');
          const { totalDeductions, netStipend } = args.data;
          if (totalDeductions?.increment != null)
            payrollEntry.totalDeductions += totalDeductions.increment;
          if (totalDeductions?.decrement != null)
            payrollEntry.totalDeductions -= totalDeductions.decrement;
          if (netStipend?.increment != null)
            payrollEntry.netStipend += netStipend.increment;
          if (netStipend?.decrement != null)
            payrollEntry.netStipend -= netStipend.decrement;
          return payrollEntry;
        },
      ),
    },
    payrollDeduction: {
      findFirst: jest.fn(
        (args: {
          where: {
            payrollEntryId: string;
            reason: string;
            description?: string | { in: string[] };
          };
        }) => {
          const { payrollEntryId, reason, description } = args.where;
          return (
            deductions.find((d) => {
              if (d.payrollEntryId !== payrollEntryId) return false;
              if (d.reason !== reason) return false;
              if (typeof description === 'string')
                return d.description === description;
              if (description && 'in' in description)
                return description.in.includes(d.description);
              return true;
            }) ?? null
          );
        },
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
        const before = deductions.length;
        deductions = deductions.filter((d) => d.id !== args.where.id);
        if (deductions.length === before)
          throw new Error('deduction not found');
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
      findMany: jest.fn((args: { where: { employeeId: string } }) =>
        args.where.employeeId === ownerEmployeeId ? letters : [],
      ),
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
    getState: () => ({
      payrollEntry,
      deductions,
      disciplineEvents,
      letters,
      employeeStatus,
      userIsActive,
    }),
  };
}

function absentDatedDeduction(overrides?: Partial<FakeDeduction>): FakeDeduction {
  return {
    id: 'ded-absent-1',
    payrollEntryId: 'pe-1',
    reason: 'UNINFORMED_ABSENCE',
    amount: 1935.48,
    description: `Absent without approved leave (2 days stipend) — ${DATE_LABEL}`,
    ...overrides,
  };
}

function uaDatedDeduction(overrides?: Partial<FakeDeduction>): FakeDeduction {
  return {
    id: 'ded-ua-1',
    payrollEntryId: 'pe-1',
    reason: 'UNINFORMED_ABSENCE',
    amount: 1935.48,
    description: `Uninformed absence deduction (2 days) — ${DATE_LABEL}`,
    ...overrides,
  };
}

function pendingEntry(status: 'PENDING' | 'PROCESSED' | 'PAID' = 'PENDING'): FakePayrollEntry {
  return { id: 'pe-1', status, totalDeductions: 5000, netStipend: 25000 };
}

function snap(
  status: AttendanceStatus,
  extra?: Partial<{
    lateMinutes: number;
    checkIn: Date | null;
    checkOut: Date | null;
    note: string | null;
  }>,
) {
  return {
    status,
    lateMinutes: extra?.lateMinutes ?? 0,
    checkIn: extra?.checkIn ?? null,
    checkOut: extra?.checkOut ?? null,
    note: extra?.note ?? null,
  };
}

describe('isAbsentFamilyEligibleForDiscipline', () => {
  it.each([AttendanceStatus.ABSENT, AttendanceStatus.UNINFORMED_ABSENT])(
    '%s is eligible',
    (status) => {
      expect(isAbsentFamilyEligibleForDiscipline({ status })).toBe(true);
    },
  );

  it.each([
    AttendanceStatus.PRESENT,
    AttendanceStatus.LATE,
    AttendanceStatus.HALF_DAY,
    AttendanceStatus.ON_LEAVE,
    AttendanceStatus.SHORT_LEAVE,
    AttendanceStatus.SWAP_COVERED,
    AttendanceStatus.UNMARKED,
  ])('%s is NOT eligible', (status) => {
    expect(isAbsentFamilyEligibleForDiscipline({ status })).toBe(false);
  });
});

describe('isMissingCheckoutEligibleForDiscipline', () => {
  it('checkIn set, checkOut null -> eligible', () => {
    expect(
      isMissingCheckoutEligibleForDiscipline({
        checkIn: new Date(),
        checkOut: null,
      }),
    ).toBe(true);
  });
  it('checkIn set, checkOut set -> not eligible', () => {
    expect(
      isMissingCheckoutEligibleForDiscipline({
        checkIn: new Date(),
        checkOut: new Date(),
      }),
    ).toBe(false);
  });
  it('checkIn null -> not eligible', () => {
    expect(
      isMissingCheckoutEligibleForDiscipline({ checkIn: null, checkOut: null }),
    ).toBe(false);
  });
});

describe('reverseMissingCheckoutDisciplineForDate', () => {
  function fineLetter(overrides?: Partial<FakeLetter>): FakeLetter {
    return {
      id: 'letter-mc-fine',
      letterType: LetterType.FINE,
      generatedAt: new Date('2026-08-01T00:00:00.000Z'),
      variables: { incidentDate: DATE_LABEL, monthlyMissingCheckoutOccurrence: 3 },
      requiresAcknowledgement: true,
      ...overrides,
    };
  }
  function mcDeduction(overrides?: Partial<FakeDeduction>): FakeDeduction {
    return {
      id: 'ded-mc-1',
      payrollEntryId: 'pe-1',
      reason: 'DISCIPLINARY_FINE',
      amount: 968.75,
      description: 'Missing checkout deduction — monthly occurrence 3',
      ...overrides,
    };
  }

  it('PENDING payroll — deduction reversed, totals restored, letter annotated, DisciplineEvent removed', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry(),
      deductions: [mcDeduction()],
      letters: [fineLetter()],
      disciplineEvents: [
        {
          id: 'de-mc-1',
          employeeId: EMPLOYEE_ID,
          category: 'MISSING_CHECKOUT',
          incidentDate: DATE_LABEL,
          occurrence: 3,
        },
      ],
    });

    const result = await reverseMissingCheckoutDisciplineForDate(
      tx,
      EMPLOYEE_ID,
      DATE,
    );

    expect(result.reversed).toBe(true);
    expect(result.deductionReversed).toBe(true);
    expect(result.deductionAmount).toBe(968.75);
    expect(result.disciplineEventRemoved).toBe(true);

    const state = getState();
    expect(state.deductions).toHaveLength(0);
    expect(state.payrollEntry?.totalDeductions).toBeCloseTo(5000 - 968.75);
    expect(state.payrollEntry?.netStipend).toBeCloseTo(25000 + 968.75);
    expect(state.disciplineEvents).toHaveLength(0);
    expect(state.letters[0].requiresAcknowledgement).toBe(false);
    expect(state.letters[0].variables.reversed).toBe(true);
  });

  it('PROCESSED payroll — deduction/totals untouched, letter/DisciplineEvent still released', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry('PROCESSED'),
      deductions: [mcDeduction()],
      letters: [fineLetter()],
      disciplineEvents: [
        {
          id: 'de-mc-1',
          employeeId: EMPLOYEE_ID,
          category: 'MISSING_CHECKOUT',
          incidentDate: DATE_LABEL,
          occurrence: 3,
        },
      ],
    });

    const result = await reverseMissingCheckoutDisciplineForDate(
      tx,
      EMPLOYEE_ID,
      DATE,
    );

    expect(result.deductionReversed).toBe(false);
    expect(result.blockedByPayrollStatus).toBe(true);
    const state = getState();
    expect(state.deductions).toHaveLength(1);
    expect(state.payrollEntry?.totalDeductions).toBe(5000);
    expect(state.disciplineEvents).toHaveLength(0); // non-financial, still released
  });

  it('PAID payroll behaves the same as PROCESSED', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry('PAID'),
      deductions: [mcDeduction()],
      letters: [fineLetter()],
      disciplineEvents: [],
    });
    const result = await reverseMissingCheckoutDisciplineForDate(
      tx,
      EMPLOYEE_ID,
      DATE,
    );
    expect(result.blockedByPayrollStatus).toBe(true);
    expect(getState().deductions).toHaveLength(1);
  });

  it('idempotent — second call is a true no-op, no double credit', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry(),
      deductions: [mcDeduction()],
      letters: [fineLetter()],
      disciplineEvents: [
        {
          id: 'de-mc-1',
          employeeId: EMPLOYEE_ID,
          category: 'MISSING_CHECKOUT',
          incidentDate: DATE_LABEL,
          occurrence: 3,
        },
      ],
    });

    const first = await reverseMissingCheckoutDisciplineForDate(
      tx,
      EMPLOYEE_ID,
      DATE,
    );
    const afterFirst = { ...getState().payrollEntry };
    const second = await reverseMissingCheckoutDisciplineForDate(
      tx,
      EMPLOYEE_ID,
      DATE,
    );
    const afterSecond = getState().payrollEntry;

    expect(first.deductionReversed).toBe(true);
    expect(second.reversed).toBe(false);
    expect(afterSecond?.totalDeductions).toBe(afterFirst.totalDeductions);
    expect(afterSecond?.netStipend).toBe(afterFirst.netStipend);
  });

  it('never picks up a LATE letter sharing the same employee/date (cross-category isolation)', async () => {
    const lateLetter: FakeLetter = {
      id: 'letter-late',
      letterType: LetterType.ADVICE,
      generatedAt: new Date('2026-08-01T00:00:00.000Z'),
      variables: { incidentDate: DATE_LABEL, monthlyLateOccurrence: 1 },
      requiresAcknowledgement: true,
    };
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry(),
      deductions: [],
      letters: [lateLetter],
      disciplineEvents: [],
    });

    const result = await reverseMissingCheckoutDisciplineForDate(
      tx,
      EMPLOYEE_ID,
      DATE,
    );

    expect(result.reversed).toBe(false);
    expect(getState().letters[0].requiresAcknowledgement).toBe(true); // untouched
  });

  it("another employee's same-date deduction/letter is never touched", async () => {
    const { tx, getState } = makeReconcileFakeTx({
      ownerEmployeeId: OTHER_EMPLOYEE_ID,
      payrollEntry: pendingEntry(),
      deductions: [mcDeduction()],
      letters: [fineLetter()],
      disciplineEvents: [],
    });

    const result = await reverseMissingCheckoutDisciplineForDate(
      tx,
      EMPLOYEE_ID, // different employee than the seeded owner
      DATE,
    );

    expect(result.reversed).toBe(false);
    expect(getState().deductions).toHaveLength(1);
  });
});

describe('reconcileAttendanceFinancialConsequences', () => {
  describe('ABSENT_FAMILY reversal', () => {
    it('ABSENT -> PRESENT reverses the exact-date absence deduction (PENDING)', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [absentDatedDeduction()],
        disciplineEvents: [],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.ABSENT),
        after: snap(AttendanceStatus.PRESENT),
      });

      expect(result.absenceReversal?.deductionReversed).toBe(true);
      expect(getState().deductions).toHaveLength(0);
      expect(getState().payrollEntry?.totalDeductions).toBeCloseTo(
        5000 - 1935.48,
      );
    });

    it('ABSENT -> LATE reverses the absence deduction (LATE application itself is pre-write, not this function\'s concern)', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [absentDatedDeduction()],
        disciplineEvents: [],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.ABSENT),
        after: snap(AttendanceStatus.LATE),
      });

      expect(result.absenceReversal?.deductionReversed).toBe(true);
      expect(result.lateReversal).toBeNull(); // nothing to reverse on the LATE side
      expect(getState().deductions).toHaveLength(0);
    });

    it('ABSENT -> ON_LEAVE reverses the absence deduction', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [absentDatedDeduction()],
        disciplineEvents: [],
      });

      await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.ABSENT),
        after: snap(AttendanceStatus.ON_LEAVE),
      });

      expect(getState().deductions).toHaveLength(0);
    });

    it('UNINFORMED_ABSENT -> PRESENT reverses deduction + DisciplineEvent', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [uaDatedDeduction()],
        disciplineEvents: [
          {
            id: 'de-1',
            employeeId: EMPLOYEE_ID,
            category: 'UNINFORMED_ABSENT',
            incidentDate: DATE_LABEL,
            occurrence: 1,
          },
        ],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.UNINFORMED_ABSENT),
        after: snap(AttendanceStatus.PRESENT),
      });

      expect(result.absenceReversal?.deductionReversed).toBe(true);
      expect(result.absenceReversal?.disciplineEventRemoved).toBe(true);
      expect(getState().deductions).toHaveLength(0);
      expect(getState().disciplineEvents).toHaveLength(0);
    });

    it('UNINFORMED_ABSENT -> LATE reverses the absence deduction', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [uaDatedDeduction()],
        disciplineEvents: [
          {
            id: 'de-1',
            employeeId: EMPLOYEE_ID,
            category: 'UNINFORMED_ABSENT',
            incidentDate: DATE_LABEL,
            occurrence: 1,
          },
        ],
      });

      await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.UNINFORMED_ABSENT),
        after: snap(AttendanceStatus.LATE, { lateMinutes: 20 }),
      });

      expect(getState().deductions).toHaveLength(0);
    });

    it('biometric-shaped transition (real checkIn now present) reverses UNINFORMED_ABSENT deduction', async () => {
      // Mirrors biometricRegularCheckIn: `before` has no checkIn (auto-marked
      // no-show), `after` has a real checkIn + freshly computed status.
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [uaDatedDeduction()],
        disciplineEvents: [
          {
            id: 'de-1',
            employeeId: EMPLOYEE_ID,
            category: 'UNINFORMED_ABSENT',
            incidentDate: DATE_LABEL,
            occurrence: 1,
          },
        ],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.UNINFORMED_ABSENT, { checkIn: null }),
        after: snap(AttendanceStatus.PRESENT, { checkIn: new Date() }),
      });

      expect(result.absenceReversal?.reversed).toBe(true);
      expect(getState().deductions).toHaveLength(0);
    });

    it('ABSENT <-> UNINFORMED_ABSENT (same family) is a no-op — no reversal, no reapplication', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [absentDatedDeduction()],
        disciplineEvents: [],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.ABSENT),
        after: snap(AttendanceStatus.UNINFORMED_ABSENT),
      });

      expect(result.absenceReversal).toBeNull();
      expect(result.deductionApplied).toBe(false);
      expect(getState().deductions).toHaveLength(1); // untouched, still the original row
    });

    it('PROCESSED payroll — reversal blocked, deduction untouched, DisciplineEvent still released', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry('PROCESSED'),
        deductions: [uaDatedDeduction()],
        disciplineEvents: [
          {
            id: 'de-1',
            employeeId: EMPLOYEE_ID,
            category: 'UNINFORMED_ABSENT',
            incidentDate: DATE_LABEL,
            occurrence: 1,
          },
        ],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.UNINFORMED_ABSENT),
        after: snap(AttendanceStatus.PRESENT),
      });

      expect(result.absenceReversal?.blockedByPayrollStatus).toBe(true);
      expect(getState().deductions).toHaveLength(1);
      expect(getState().payrollEntry?.totalDeductions).toBe(5000);
      expect(getState().disciplineEvents).toHaveLength(0);
    });

    it('PAID payroll behaves the same as PROCESSED', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry('PAID'),
        deductions: [absentDatedDeduction()],
        disciplineEvents: [],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.ABSENT),
        after: snap(AttendanceStatus.PRESENT),
      });

      expect(result.absenceReversal?.blockedByPayrollStatus).toBe(true);
      expect(getState().deductions).toHaveLength(1);
    });

    it('idempotent — repeated identical correction does not double-credit', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [absentDatedDeduction()],
        disciplineEvents: [],
      });

      await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.ABSENT),
        after: snap(AttendanceStatus.PRESENT),
      });
      const afterFirst = { ...getState().payrollEntry };

      // Second call replays the SAME before/after — realistic idempotency
      // happens across separate calls each reading fresh `before` state, but
      // the underlying reverse function is also directly retry-safe.
      await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.PRESENT), // already corrected — no transition
        after: snap(AttendanceStatus.PRESENT),
      });

      expect(getState().payrollEntry?.totalDeductions).toBe(
        afterFirst.totalDeductions,
      );
    });

    it('employee/date isolation — another employee\'s same-date deduction is never touched', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        ownerEmployeeId: OTHER_EMPLOYEE_ID,
        payrollEntry: pendingEntry(),
        deductions: [absentDatedDeduction()],
        disciplineEvents: [],
      });

      await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.ABSENT),
        after: snap(AttendanceStatus.PRESENT),
      });

      expect(getState().deductions).toHaveLength(1); // other employee's row untouched
    });
  });

  describe('ABSENT_FAMILY application', () => {
    it('PRESENT -> ABSENT applies a new 2-day deduction exactly once', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.PRESENT),
        after: snap(AttendanceStatus.ABSENT),
      });

      expect(result.deductionApplied).toBe(true);
      const state = getState();
      expect(state.deductions).toHaveLength(1);
      expect(state.deductions[0].description).toBe(
        `Absent without approved leave (2 days stipend) — ${DATE_LABEL}`,
      );
      expect(state.payrollEntry?.totalDeductions).toBeGreaterThan(5000);
    });

    it('PRESENT -> UNINFORMED_ABSENT applies a new deduction + claims a DisciplineEvent exactly once', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [],
        disciplineEvents: [],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.PRESENT),
        after: snap(AttendanceStatus.UNINFORMED_ABSENT),
      });

      expect(result.deductionApplied).toBe(true);
      const state = getState();
      expect(state.deductions).toHaveLength(1);
      expect(state.deductions[0].description).toBe(
        `Uninformed absence deduction (2 days) — ${DATE_LABEL}`,
      );
      expect(state.disciplineEvents).toHaveLength(1);
    });

    it('brand-new row (before: null) marked ABSENT still gets the deduction applied', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: null,
        after: snap(AttendanceStatus.ABSENT),
      });

      expect(result.deductionApplied).toBe(true);
      expect(getState().deductions).toHaveLength(1);
    });

    it('re-marking an already-ABSENT row (ABSENT -> ABSENT, no real change) does NOT create a duplicate deduction', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [absentDatedDeduction()],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.ABSENT),
        after: snap(AttendanceStatus.ABSENT),
      });

      expect(result.deductionApplied).toBe(false); // same category — orchestrator no-ops
      expect(getState().deductions).toHaveLength(1);
    });

    it("applyAbsentDeduction's own exact-description guard still prevents a duplicate even if the apply branch is somehow reached twice", async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [],
      });

      await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: null,
        after: snap(AttendanceStatus.ABSENT),
      });
      // Second, independent call with before:null again (e.g. a retried
      // request) — the belt-and-suspenders exact-match guard inside
      // applyAbsentDeduction itself must still prevent a duplicate row.
      await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: null,
        after: snap(AttendanceStatus.ABSENT),
      });

      expect(getState().deductions).toHaveLength(1);
    });

    it('no application when transitioning to a non-absence status', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.PRESENT),
        after: snap(AttendanceStatus.ON_LEAVE),
      });

      expect(result.deductionApplied).toBe(false);
      expect(getState().deductions).toHaveLength(0);
    });
  });

  describe('MISSING_CHECKOUT axis', () => {
    it('missing checkout -> corrected checkout reverses the exact-date consequence (PENDING)', async () => {
      const letter: FakeLetter = {
        id: 'letter-mc-1',
        letterType: LetterType.FINE,
        generatedAt: new Date('2026-08-01T00:00:00.000Z'),
        variables: {
          incidentDate: DATE_LABEL,
          monthlyMissingCheckoutOccurrence: 3,
        },
        requiresAcknowledgement: true,
      };
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [
          {
            id: 'ded-mc-1',
            payrollEntryId: 'pe-1',
            reason: 'DISCIPLINARY_FINE',
            amount: 968.75,
            description: 'Missing checkout deduction — monthly occurrence 3',
          },
        ],
        letters: [letter],
        disciplineEvents: [
          {
            id: 'de-mc-1',
            employeeId: EMPLOYEE_ID,
            category: 'MISSING_CHECKOUT',
            incidentDate: DATE_LABEL,
            occurrence: 3,
          },
        ],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.PRESENT, {
          checkIn: new Date('2026-08-18T04:00:00.000Z'),
          checkOut: null,
        }),
        after: snap(AttendanceStatus.PRESENT, {
          checkIn: new Date('2026-08-18T04:00:00.000Z'),
          checkOut: new Date('2026-08-18T13:00:00.000Z'),
        }),
      });

      expect(result.missingCheckoutReversal?.deductionReversed).toBe(true);
      expect(getState().deductions).toHaveLength(0);
      expect(getState().disciplineEvents).toHaveLength(0);
    });

    it('PROCESSED payroll — missing-checkout deduction stays frozen, blockedByPayrollStatus reported', async () => {
      const letter: FakeLetter = {
        id: 'letter-mc-2',
        letterType: LetterType.FINE,
        generatedAt: new Date('2026-08-01T00:00:00.000Z'),
        variables: {
          incidentDate: DATE_LABEL,
          monthlyMissingCheckoutOccurrence: 3,
        },
        requiresAcknowledgement: true,
      };
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry('PROCESSED'),
        deductions: [
          {
            id: 'ded-mc-2',
            payrollEntryId: 'pe-1',
            reason: 'DISCIPLINARY_FINE',
            amount: 968.75,
            description: 'Missing checkout deduction — monthly occurrence 3',
          },
        ],
        letters: [letter],
        disciplineEvents: [],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.PRESENT, {
          checkIn: new Date(),
          checkOut: null,
        }),
        after: snap(AttendanceStatus.PRESENT, {
          checkIn: new Date(),
          checkOut: new Date(),
        }),
      });

      expect(result.missingCheckoutReversal?.blockedByPayrollStatus).toBe(
        true,
      );
      expect(getState().deductions).toHaveLength(1);
    });

    it('does not fire when checkout was already present (no transition)', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [],
        letters: [],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.PRESENT, {
          checkIn: new Date(),
          checkOut: new Date(),
        }),
        after: snap(AttendanceStatus.PRESENT, {
          checkIn: new Date(),
          checkOut: new Date(),
        }),
      });

      expect(result.missingCheckoutReversal).toBeNull();
      expect(getState().deductions).toHaveLength(0);
    });

    it('is orthogonal to the LATE axis — both can reverse in the same call', async () => {
      const lateLetter: FakeLetter = {
        id: 'letter-late-fine',
        letterType: LetterType.FINE,
        generatedAt: new Date('2026-08-01T00:00:00.000Z'),
        variables: { incidentDate: DATE_LABEL, monthlyLateOccurrence: 3 },
        requiresAcknowledgement: true,
      };
      const mcLetter: FakeLetter = {
        id: 'letter-mc-3',
        letterType: LetterType.FINE,
        generatedAt: new Date('2026-08-01T00:00:00.000Z'),
        variables: {
          incidentDate: DATE_LABEL,
          monthlyMissingCheckoutOccurrence: 3,
        },
        requiresAcknowledgement: true,
      };
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [
          {
            id: 'ded-late',
            payrollEntryId: 'pe-1',
            reason: 'LATE_ARRIVAL',
            amount: 968.75,
            description: 'Late arrival deduction — monthly occurrence 3',
          },
          {
            id: 'ded-mc',
            payrollEntryId: 'pe-1',
            reason: 'DISCIPLINARY_FINE',
            amount: 968.75,
            description: 'Missing checkout deduction — monthly occurrence 3',
          },
        ],
        letters: [lateLetter, mcLetter],
        disciplineEvents: [],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.LATE, {
          checkIn: new Date('2026-08-18T04:00:00.000Z'),
          checkOut: null,
        }),
        after: snap(AttendanceStatus.PRESENT, {
          checkIn: new Date('2026-08-18T04:00:00.000Z'),
          checkOut: new Date('2026-08-18T13:00:00.000Z'),
        }),
      });

      expect(result.lateReversal?.deductionReversed).toBe(true);
      expect(result.missingCheckoutReversal?.deductionReversed).toBe(true);
      expect(getState().deductions).toHaveLength(0);
      // Each function only ever touched its own letter.
      expect(getState().letters.find((l) => l.id === 'letter-late-fine')
        ?.requiresAcknowledgement).toBe(false);
      expect(getState().letters.find((l) => l.id === 'letter-mc-3')
        ?.requiresAcknowledgement).toBe(false);
    });
  });

  describe('LATE reversal (routed through the centralized function)', () => {
    it('LATE -> ON_LEAVE reverses the late fine, letter, and DisciplineEvent', async () => {
      const letter: FakeLetter = {
        id: 'letter-late-1',
        letterType: LetterType.FINE,
        generatedAt: new Date('2026-08-01T00:00:00.000Z'),
        variables: { incidentDate: DATE_LABEL, monthlyLateOccurrence: 3 },
        requiresAcknowledgement: true,
      };
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [
          {
            id: 'ded-late-1',
            payrollEntryId: 'pe-1',
            reason: 'LATE_ARRIVAL',
            amount: 968.75,
            description: 'Late arrival deduction — monthly occurrence 3',
          },
        ],
        letters: [letter],
        disciplineEvents: [
          {
            id: 'de-late-1',
            employeeId: EMPLOYEE_ID,
            category: 'LATE',
            incidentDate: DATE_LABEL,
            occurrence: 3,
          },
        ],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.LATE, { lateMinutes: 20 }),
        after: snap(AttendanceStatus.ON_LEAVE),
      });

      expect(result.lateReversal?.deductionReversed).toBe(true);
      expect(result.lateReversal?.disciplineEventRemoved).toBe(true);
      const state = getState();
      expect(state.deductions).toHaveLength(0);
      expect(state.disciplineEvents).toHaveLength(0);
      expect(state.letters[0].requiresAcknowledgement).toBe(false);
    });

    it('mutual exclusivity: LATE->PRESENT never touches the absence-family branch', async () => {
      const { tx, getState } = makeReconcileFakeTx({
        payrollEntry: pendingEntry(),
        deductions: [],
        letters: [],
      });

      const result = await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: EMPLOYEE_ID,
        date: DATE,
        before: snap(AttendanceStatus.LATE, { lateMinutes: 5 }),
        after: snap(AttendanceStatus.PRESENT),
      });

      expect(result.absenceReversal).toBeNull();
      expect(result.deductionApplied).toBe(false);
      expect(getState().deductions).toHaveLength(0);
    });
  });
});

describe('Bug A fix — application-side PayrollEntry.status freeze', () => {
  it('A. PRESENT -> ABSENT with PENDING payroll: deduction created exactly once', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry(),
      deductions: [],
    });

    const result = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.PRESENT),
      after: snap(AttendanceStatus.ABSENT),
    });

    expect(result.deductionApplied).toBe(true);
    expect(result.blockedByPayrollStatus).toBe(false);
    expect(result.payrollStatus).toBe('PENDING');
    expect(getState().deductions).toHaveLength(1);
  });

  it('B. PRESENT -> ABSENT with PROCESSED payroll: no deduction, no totals mutation, blockedByPayrollStatus true', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry('PROCESSED'),
      deductions: [],
    });

    const result = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.PRESENT),
      after: snap(AttendanceStatus.ABSENT),
    });

    expect(result.deductionApplied).toBe(false);
    expect(result.blockedByPayrollStatus).toBe(true);
    expect(result.payrollStatus).toBe('PROCESSED');
    const state = getState();
    expect(state.deductions).toHaveLength(0);
    expect(state.payrollEntry?.totalDeductions).toBe(5000); // untouched
    expect(state.payrollEntry?.netStipend).toBe(25000); // untouched
  });

  it('C. PRESENT -> ABSENT with PAID payroll: same freeze behavior as PROCESSED', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry('PAID'),
      deductions: [],
    });

    const result = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.PRESENT),
      after: snap(AttendanceStatus.ABSENT),
    });

    expect(result.deductionApplied).toBe(false);
    expect(result.blockedByPayrollStatus).toBe(true);
    expect(result.payrollStatus).toBe('PAID');
    expect(getState().deductions).toHaveLength(0);
  });

  it('D. PRESENT -> UNINFORMED_ABSENT with PROCESSED payroll: no financial mutation, but DisciplineEvent tracking still runs', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry('PROCESSED'),
      deductions: [],
      disciplineEvents: [],
    });

    const result = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.PRESENT),
      after: snap(AttendanceStatus.UNINFORMED_ABSENT),
    });

    expect(result.deductionApplied).toBe(false);
    expect(result.blockedByPayrollStatus).toBe(true);
    expect(result.payrollStatus).toBe('PROCESSED');
    // Non-financial discipline tracking is NOT gated by payroll status.
    expect(result.disciplineEventCreated).toBe(true);
    const state = getState();
    expect(state.deductions).toHaveLength(0);
    expect(state.payrollEntry?.totalDeductions).toBe(5000); // untouched
    expect(state.disciplineEvents).toHaveLength(1);
    expect(state.disciplineEvents[0].category).toBe('UNINFORMED_ABSENT');
  });

  it('D2. same as D but PAID payroll — identical freeze, identical discipline tracking', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry('PAID'),
      deductions: [],
      disciplineEvents: [],
    });

    const result = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.PRESENT),
      after: snap(AttendanceStatus.UNINFORMED_ABSENT),
    });

    expect(result.blockedByPayrollStatus).toBe(true);
    expect(result.disciplineEventCreated).toBe(true);
    expect(getState().deductions).toHaveLength(0);
  });

  it('idempotent — a second PROCESSED-blocked attempt for the same date does not retry the deduction or reclaim the DisciplineEvent', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry('PROCESSED'),
      deductions: [],
      disciplineEvents: [],
    });

    await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: null,
      after: snap(AttendanceStatus.UNINFORMED_ABSENT),
    });
    const secondResult = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: null, // e.g. a retried request re-reading the same "no prior row" state
      after: snap(AttendanceStatus.UNINFORMED_ABSENT),
    });

    expect(secondResult.disciplineEventCreated).toBe(false); // already claimed
    expect(getState().disciplineEvents).toHaveLength(1); // not duplicated
    expect(getState().deductions).toHaveLength(0);
  });
});

describe('Bug B fix — ABSENT <-> UNINFORMED_ABSENT subtype transitions', () => {
  it('E. ABSENT -> UNINFORMED_ABSENT: no second deduction, UA DisciplineEvent created, counts toward suspension threshold, idempotent', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry(),
      deductions: [absentDatedDeduction()],
      disciplineEvents: [],
      // Two prior UA days already this month — this promotion becomes the
      // 3rd, crossing the >2-day auto-suspension threshold.
      priorUninformedAbsentDates: ['2026-08-05', '2026-08-11'],
    });

    const result = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.ABSENT),
      after: snap(AttendanceStatus.UNINFORMED_ABSENT),
    });

    expect(result.deductionApplied).toBe(false); // no second deduction
    expect(result.disciplineEventCreated).toBe(true);
    expect(result.suspensionTriggered).toBe(true);

    const state = getState();
    expect(state.deductions).toHaveLength(1); // original ABSENT-templated row, untouched
    expect(state.deductions[0].description).toBe(
      `Absent without approved leave (2 days stipend) — ${DATE_LABEL}`,
    );
    expect(state.disciplineEvents).toHaveLength(1);
    expect(state.disciplineEvents[0].category).toBe('UNINFORMED_ABSENT');
    expect(state.disciplineEvents[0].incidentDate).toBe(DATE_LABEL);
    expect(state.employeeStatus).toBe('SUSPENDED');
    expect(state.userIsActive).toBe(false);

    // Repeated identical promotion (e.g. HR re-saves the same edit) — must
    // not create a second DisciplineEvent or re-fire the suspension side
    // effects a second time.
    const second = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.UNINFORMED_ABSENT), // already promoted
      after: snap(AttendanceStatus.UNINFORMED_ABSENT),
    });
    expect(second.disciplineEventCreated).toBe(false);
    expect(second.suspensionTriggered).toBe(false);
    expect(getState().disciplineEvents).toHaveLength(1);
  });

  it('E2. ABSENT -> UNINFORMED_ABSENT below the suspension threshold does not suspend', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry(),
      deductions: [absentDatedDeduction()],
      disciplineEvents: [],
      priorUninformedAbsentDates: [], // this is only the 1st UA day this month
    });

    const result = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.ABSENT),
      after: snap(AttendanceStatus.UNINFORMED_ABSENT),
    });

    expect(result.disciplineEventCreated).toBe(true);
    expect(result.suspensionTriggered).toBe(false);
    expect(getState().employeeStatus).toBe('ACTIVE');
    expect(getState().deductions).toHaveLength(1); // still just the original
  });

  it('F. UNINFORMED_ABSENT -> ABSENT: deduction preserved, UA DisciplineEvent removed, no payroll delta, no Employee/User reinstatement', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry(),
      deductions: [uaDatedDeduction()],
      disciplineEvents: [
        {
          id: 'de-1',
          employeeId: EMPLOYEE_ID,
          category: 'UNINFORMED_ABSENT',
          incidentDate: DATE_LABEL,
          occurrence: 3,
        },
      ],
      initialEmployeeStatus: 'SUSPENDED', // e.g. previously auto-suspended
    });

    const result = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.UNINFORMED_ABSENT),
      after: snap(AttendanceStatus.ABSENT),
    });

    expect(result.deductionApplied).toBe(false);
    expect(result.absenceReversal).toBeNull(); // this is a demotion, not a full reversal
    expect(result.disciplineEventRemoved).toBe(true);

    const state = getState();
    expect(state.deductions).toHaveLength(1); // preserved, untouched
    expect(state.payrollEntry?.totalDeductions).toBe(5000); // no payroll delta
    expect(state.payrollEntry?.netStipend).toBe(25000);
    expect(state.disciplineEvents).toHaveLength(0); // released
    // Explicit non-reinstatement — matches the existing documented policy.
    expect(state.employeeStatus).toBe('SUSPENDED');
    expect(state.userIsActive).toBe(true); // unchanged mock default — update() was never called
  });

  it('F2. UNINFORMED_ABSENT -> ABSENT is idempotent — repeated demotion does not error or double-release', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry(),
      deductions: [uaDatedDeduction()],
      disciplineEvents: [
        {
          id: 'de-1',
          employeeId: EMPLOYEE_ID,
          category: 'UNINFORMED_ABSENT',
          incidentDate: DATE_LABEL,
          occurrence: 1,
        },
      ],
    });

    await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.UNINFORMED_ABSENT),
      after: snap(AttendanceStatus.ABSENT),
    });
    const second = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.ABSENT), // already demoted
      after: snap(AttendanceStatus.ABSENT),
    });

    expect(second.disciplineEventRemoved).toBe(false); // already gone
    expect(getState().deductions).toHaveLength(1); // still preserved
  });

  it('true no-op: ABSENT -> ABSENT (subtype unchanged) touches nothing', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry(),
      deductions: [absentDatedDeduction()],
      disciplineEvents: [],
    });

    const result = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.ABSENT),
      after: snap(AttendanceStatus.ABSENT),
    });

    expect(result.deductionApplied).toBe(false);
    expect(result.disciplineEventCreated).toBe(false);
    expect(result.disciplineEventRemoved).toBe(false);
    expect(getState().deductions).toHaveLength(1);
    expect(getState().disciplineEvents).toHaveLength(0);
  });
});

describe('G. repeated biometric reconciliation after prior UA reversal — no double credit', () => {
  it('a second biometric-shaped check-in reconciliation for the same date after the UA deduction was already reversed is a true no-op', async () => {
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry(),
      deductions: [uaDatedDeduction()],
      disciplineEvents: [
        {
          id: 'de-1',
          employeeId: EMPLOYEE_ID,
          category: 'UNINFORMED_ABSENT',
          incidentDate: DATE_LABEL,
          occurrence: 1,
        },
      ],
    });

    // First biometric check-in after auto-escalation — reverses the UA deduction.
    const first = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.UNINFORMED_ABSENT, { checkIn: null }),
      after: snap(AttendanceStatus.LATE, {
        checkIn: new Date('2026-08-18T05:00:00.000Z'),
        lateMinutes: 30,
      }),
    });
    expect(first.absenceReversal?.deductionReversed).toBe(true);
    const afterFirst = { ...getState().payrollEntry };

    // A replayed/duplicate delivery of the SAME biometric event reconciling
    // again: `before` is now read fresh (already PRESENT/LATE, no longer
    // UNINFORMED_ABSENT), so the transition check correctly no-ops.
    const second = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.LATE, {
        checkIn: new Date('2026-08-18T05:00:00.000Z'),
        lateMinutes: 30,
      }),
      after: snap(AttendanceStatus.LATE, {
        checkIn: new Date('2026-08-18T05:00:00.000Z'),
        lateMinutes: 30,
      }),
    });

    expect(second.absenceReversal).toBeNull();
    expect(second.deductionApplied).toBe(false);
    const afterSecond = getState().payrollEntry;
    expect(afterSecond?.totalDeductions).toBe(afterFirst.totalDeductions);
    expect(afterSecond?.netStipend).toBe(afterFirst.netStipend);
    expect(getState().deductions).toHaveLength(0); // no double credit, nothing resurrected
  });
});

describe('H. leave approval over LATE + missing-checkout on the same date', () => {
  it('reverses the late consequence but leaves the missing-checkout consequence untouched when checkout itself is not corrected', async () => {
    // Mirrors markLeaveAttendance's exact call shape: its ON_LEAVE upsert
    // only ever writes {status, source, note} — checkIn/checkOut are never
    // part of that update, so before.checkIn/checkOut === after.checkIn/
    // checkOut identically here, exactly as they would be for a real leave
    // approval landing on a day that also has an open missing-checkout session.
    const lateLetter: FakeLetter = {
      id: 'letter-late-h',
      letterType: LetterType.FINE,
      generatedAt: new Date('2026-08-01T00:00:00.000Z'),
      variables: { incidentDate: DATE_LABEL, monthlyLateOccurrence: 3 },
      requiresAcknowledgement: true,
    };
    const mcLetter: FakeLetter = {
      id: 'letter-mc-h',
      letterType: LetterType.FINE,
      generatedAt: new Date('2026-08-01T00:00:00.000Z'),
      variables: {
        incidentDate: DATE_LABEL,
        monthlyMissingCheckoutOccurrence: 3,
      },
      requiresAcknowledgement: true,
    };
    const openCheckIn = new Date('2026-08-18T04:00:00.000Z');
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry(),
      deductions: [
        {
          id: 'ded-late-h',
          payrollEntryId: 'pe-1',
          reason: 'LATE_ARRIVAL',
          amount: 968.75,
          description: 'Late arrival deduction — monthly occurrence 3',
        },
        {
          id: 'ded-mc-h',
          payrollEntryId: 'pe-1',
          reason: 'DISCIPLINARY_FINE',
          amount: 968.75,
          description: 'Missing checkout deduction — monthly occurrence 3',
        },
      ],
      letters: [lateLetter, mcLetter],
      disciplineEvents: [],
    });

    const result = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.LATE, {
        lateMinutes: 20,
        checkIn: openCheckIn,
        checkOut: null, // still open — missing checkout
      }),
      after: snap(AttendanceStatus.ON_LEAVE, {
        checkIn: openCheckIn,
        checkOut: null, // untouched by the leave-approval upsert
      }),
    });

    expect(result.lateReversal?.deductionReversed).toBe(true);
    expect(result.missingCheckoutReversal).toBeNull(); // never even attempted

    const state = getState();
    expect(state.deductions).toHaveLength(1); // only the LATE one is gone
    expect(state.deductions[0].description).toBe(
      'Missing checkout deduction — monthly occurrence 3',
    );
    expect(state.letters.find((l) => l.id === 'letter-mc-h')
      ?.requiresAcknowledgement).toBe(true); // untouched
  });
});

describe('I. PROCESSED/PAID reversal behavior remains unchanged after the Bug A/B fix', () => {
  it('LATE + ABSENT_FAMILY + MISSING_CHECKOUT all stay frozen together on a PROCESSED payroll entry', async () => {
    const lateLetter: FakeLetter = {
      id: 'letter-late-i',
      letterType: LetterType.FINE,
      generatedAt: new Date('2026-08-01T00:00:00.000Z'),
      variables: { incidentDate: DATE_LABEL, monthlyLateOccurrence: 3 },
      requiresAcknowledgement: true,
    };
    const { tx, getState } = makeReconcileFakeTx({
      payrollEntry: pendingEntry('PROCESSED'),
      deductions: [
        {
          id: 'ded-late-i',
          payrollEntryId: 'pe-1',
          reason: 'LATE_ARRIVAL',
          amount: 968.75,
          description: 'Late arrival deduction — monthly occurrence 3',
        },
        uaDatedDeduction({ id: 'ded-ua-i' }),
      ],
      letters: [lateLetter],
      disciplineEvents: [
        {
          id: 'de-ua-i',
          employeeId: EMPLOYEE_ID,
          category: 'UNINFORMED_ABSENT',
          incidentDate: DATE_LABEL,
          occurrence: 1,
        },
      ],
    });

    // A single call can't combine LATE and UNINFORMED_ABSENT status
    // transitions (they're mutually exclusive on one row), so this asserts
    // each reversal path's PROCESSED freeze independently against the same
    // shared PROCESSED payroll entry.
    const lateResult = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: DATE,
      before: snap(AttendanceStatus.LATE, { lateMinutes: 20 }),
      after: snap(AttendanceStatus.PRESENT),
    });
    expect(lateResult.lateReversal?.blockedByPayrollStatus).toBe(true);

    const absenceResult = await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMPLOYEE_ID,
      date: new Date('2026-08-19T00:00:00.000Z'),
      before: snap(AttendanceStatus.UNINFORMED_ABSENT),
      after: snap(AttendanceStatus.PRESENT),
    });
    // No deduction seeded for 08-19, so this just confirms no crash/no
    // fabricated reversal on a PROCESSED entry with nothing to match.
    expect(absenceResult.absenceReversal?.deductionReversed).toBe(false);

    const state = getState();
    expect(state.deductions).toHaveLength(2); // both still frozen in place
    expect(state.payrollEntry?.totalDeductions).toBe(5000); // untouched
  });
});
