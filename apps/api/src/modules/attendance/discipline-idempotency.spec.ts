import { AttendanceStatus, LetterType, Prisma } from '@prisma/client';
import { applyDisciplineRules } from './discipline.helper';

// issueAutoTemplatedLetter does PDF generation / filesystem writes / letter
// numbering — irrelevant to what this suite proves (idempotency of the
// discipline gate itself) and expensive to run for real. Stubbed at the
// module boundary so every test exercises discipline.helper.ts's own logic
// end-to-end, with only the letter-issuing side-effect replaced by a spy.
const issueAutoTemplatedLetter = jest
  .fn<Promise<void>, unknown[]>()
  .mockResolvedValue(undefined);
jest.mock('./../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: (...args: unknown[]): Promise<void> =>
    issueAutoTemplatedLetter(...args),
}));

const EMPLOYEE_ID = 'emp-1';
const BASIC_STIPEND = 30000;

type FakeTx = {
  disciplineEvent: { create: jest.Mock };
  employee: { findUnique: jest.Mock; update: jest.Mock };
  user: { updateMany: jest.Mock };
  attendanceLog: { findMany: jest.Mock };
  letter: { findMany: jest.Mock };
  stipendRecord: { findFirst: jest.Mock };
  payrollEntry: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  payrollDeduction: { findFirst: jest.Mock; create: jest.Mock };
  leaveRecord: { findFirst: jest.Mock };
};

/**
 * In-memory Prisma.TransactionClient stand-in shared across every
 * "concurrent" call in a test — the disciplineEvent store's check-then-set
 * happens synchronously within a single microtask (exactly like a real
 * unique-constraint INSERT does relative to a concurrent transaction), so
 * running N calls via Promise.all against ONE of these faithfully exercises
 * the same atomicity claimDisciplineEvent relies on in production, without
 * needing a live Postgres connection.
 */
/** Narrows the hand-built FakeTx to the Prisma.TransactionClient shape
 * applyDisciplineRules expects, without an unchecked `any` at every call
 * site — the fake only implements the handful of methods this code path
 * actually calls, which `unknown` intentionally papers over here. */
function asTx(tx: FakeTx): Prisma.TransactionClient {
  return tx as unknown as Prisma.TransactionClient;
}

function makeFakeTx(priorLateDaysByCall: () => { date: Date }[]): FakeTx {
  const disciplineEventKeys = new Set<string>();
  const payrollDeductionDescriptions = new Set<string>();
  let payrollEntryCreated = false;

  return {
    disciplineEvent: {
      create: jest.fn(
        ({
          data,
        }: {
          data: {
            employeeId: string;
            category: string;
            incidentDate: Date;
            occurrence: number;
          };
        }) => {
          const key = `${data.employeeId}|${data.category}|${data.incidentDate.toISOString()}`;
          if (disciplineEventKeys.has(key)) {
            const err = Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
            });
            throw err;
          }
          disciplineEventKeys.add(key);
          return Promise.resolve({ id: `de-${key}`, ...data });
        },
      ),
    },
    employee: {
      findUnique: jest.fn().mockResolvedValue({
        id: EMPLOYEE_ID,
        dutyStartTime: '09:00',
        dutyEndTime: '17:00',
        stipendRecords: [{ basicStipend: BASIC_STIPEND }],
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    user: { updateMany: jest.fn().mockResolvedValue(undefined) },
    attendanceLog: {
      findMany: jest.fn(() => Promise.resolve(priorLateDaysByCall())),
    },
    letter: { findMany: jest.fn().mockResolvedValue([]) },
    stipendRecord: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'stipend-1',
        employeeId: EMPLOYEE_ID,
        basicStipend: BASIC_STIPEND,
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
      }),
    },
    payrollEntry: {
      findUnique: jest.fn(() =>
        Promise.resolve(
          payrollEntryCreated
            ? {
                id: 'payroll-entry-1',
                stipendRecordId: 'stipend-1',
                month: 8,
                year: 2026,
                status: 'PENDING',
              }
            : null,
        ),
      ),
      create: jest.fn(() => {
        payrollEntryCreated = true;
        return Promise.resolve({
          id: 'payroll-entry-1',
          stipendRecordId: 'stipend-1',
          month: 8,
          year: 2026,
          status: 'PENDING',
        });
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    payrollDeduction: {
      findFirst: jest.fn(({ where }: { where: { description: string } }) =>
        Promise.resolve(
          payrollDeductionDescriptions.has(where.description)
            ? { id: `ded-${where.description}` }
            : null,
        ),
      ),
      create: jest.fn(({ data }: { data: { description: string } }) => {
        payrollDeductionDescriptions.add(data.description);
        return Promise.resolve({ id: `ded-${data.description}`, ...data });
      }),
    },
    leaveRecord: { findFirst: jest.fn().mockResolvedValue(null) },
  };
}

describe('discipline idempotency gate (DisciplineEvent)', () => {
  beforeEach(() => {
    issueAutoTemplatedLetter.mockClear();
  });

  it('10 concurrent executions of the SAME incident (occurrence 3, Fine) produce exactly ONE DisciplineEvent, ONE letter, and at most ONE deduction', async () => {
    const incidentDate = new Date('2026-08-17T00:00:00.000Z');
    // Two other distinct prior late days this month + this one = lateCount 3
    // -> positionInCycle 3, lateCount !== 9 -> Fine + 1-day deduction branch.
    const priorDays = [
      { date: new Date('2026-08-03T00:00:00.000Z') },
      { date: new Date('2026-08-10T00:00:00.000Z') },
    ];
    const tx = makeFakeTx(() => priorDays);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        applyDisciplineRules(
          asTx(tx),
          EMPLOYEE_ID,
          AttendanceStatus.LATE,
          incidentDate,
          { lateMinutes: 20 },
        ),
      ),
    );

    expect(results).toHaveLength(10);

    // Exactly ONE of the 10 concurrent claim attempts succeeded.
    expect(tx.disciplineEvent.create).toHaveBeenCalledTimes(10);
    const successfulClaims = tx.disciplineEvent.create.mock.results.filter(
      (r) => r.type === 'return',
    );
    expect(successfulClaims).toHaveLength(1);

    // Exactly ONE letter (FINE) was issued.
    expect(issueAutoTemplatedLetter).toHaveBeenCalledTimes(1);
    expect(issueAutoTemplatedLetter.mock.calls[0][1]).toMatchObject({
      letterType: LetterType.FINE,
    });

    // At most ONE deduction was created.
    expect(tx.payrollDeduction.create).toHaveBeenCalledTimes(1);
  });

  it('10 concurrent executions of occurrence 1 (Advice, no deduction) produce exactly ONE DisciplineEvent and ONE letter, zero deductions', async () => {
    const incidentDate = new Date('2026-08-05T00:00:00.000Z');
    const tx = makeFakeTx(() => []); // no prior late days -> lateCount 1

    await Promise.all(
      Array.from({ length: 10 }, () =>
        applyDisciplineRules(
          asTx(tx),
          EMPLOYEE_ID,
          AttendanceStatus.LATE,
          incidentDate,
          { lateMinutes: 10 },
        ),
      ),
    );

    const successfulClaims = tx.disciplineEvent.create.mock.results.filter(
      (r) => r.type === 'return',
    );
    expect(successfulClaims).toHaveLength(1);
    expect(issueAutoTemplatedLetter).toHaveBeenCalledTimes(1);
    expect(issueAutoTemplatedLetter.mock.calls[0][1]).toMatchObject({
      letterType: LetterType.ADVICE,
    });
    expect(tx.payrollDeduction.create).not.toHaveBeenCalled();
  });

  it('two DIFFERENT incident dates each produce their own legitimate DisciplineEvent + letter (never suppressed by each other)', async () => {
    const dateA = new Date('2026-08-05T00:00:00.000Z');
    const dateB = new Date('2026-08-19T00:00:00.000Z');
    const tx = makeFakeTx(() => []); // both independently compute lateCount 1

    await applyDisciplineRules(
      asTx(tx),
      EMPLOYEE_ID,
      AttendanceStatus.LATE,
      dateA,
      { lateMinutes: 5 },
    );
    await applyDisciplineRules(
      asTx(tx),
      EMPLOYEE_ID,
      AttendanceStatus.LATE,
      dateB,
      { lateMinutes: 5 },
    );

    const successfulClaims = tx.disciplineEvent.create.mock.results.filter(
      (r) => r.type === 'return',
    );
    expect(successfulClaims).toHaveLength(2);
    expect(issueAutoTemplatedLetter).toHaveBeenCalledTimes(2);
  });

  it('occurrence 9 produces a SUSPENSION letter and NO LATE_ARRIVAL deduction (regression guard for the pre-76deef6 legacy bug)', async () => {
    const incidentDate = new Date('2026-08-30T00:00:00.000Z');
    // 8 distinct prior late days + this one = lateCount 9.
    const priorDays = Array.from({ length: 8 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 7, i + 1)),
    }));
    const tx = makeFakeTx(() => priorDays);

    await applyDisciplineRules(
      asTx(tx),
      EMPLOYEE_ID,
      AttendanceStatus.LATE,
      incidentDate,
      { lateMinutes: 30 },
    );

    expect(issueAutoTemplatedLetter).toHaveBeenCalledTimes(1);
    expect(issueAutoTemplatedLetter.mock.calls[0][1]).toMatchObject({
      letterType: LetterType.SUSPENSION,
    });
    expect(tx.payrollDeduction.create).not.toHaveBeenCalled();
    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SUSPENDED' } }),
    );
  });

  it('10 concurrent UNINFORMED_ABSENT executions for the same incident produce exactly ONE DisciplineEvent and at most ONE deduction', async () => {
    const incidentDate = new Date('2026-08-12T00:00:00.000Z');
    const tx = makeFakeTx(() => []);
    tx.attendanceLog.findMany.mockResolvedValue([]); // no prior uninformed-absent days

    await Promise.all(
      Array.from({ length: 10 }, () =>
        applyDisciplineRules(
          asTx(tx),
          EMPLOYEE_ID,
          AttendanceStatus.UNINFORMED_ABSENT,
          incidentDate,
        ),
      ),
    );

    const successfulClaims = tx.disciplineEvent.create.mock.results.filter(
      (r) => r.type === 'return',
    );
    expect(successfulClaims).toHaveLength(1);
    expect(tx.payrollDeduction.create).toHaveBeenCalledTimes(1);
  });
});
