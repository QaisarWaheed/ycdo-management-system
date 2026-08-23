/**
 * Missing-checkout occurrence must be chronological among DisciplineEvent
 * claims for the employee+month — never derived from currently-open
 * AttendanceLog rows (that reset when earlier days later receive checkout).
 */
jest.mock('../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn(async () => ({ id: 'letter-1' })),
}));

jest.mock('./temporary-auto-checkout', () => ({
  isTemporaryAutoCheckoutEnabled: jest.fn(() => false),
}));

import { LetterType, Prisma } from '@prisma/client';
import { issueAutoTemplatedLetter } from '../letters/auto-letter.helper';
import {
  applyMissingCheckoutDiscipline,
  renumberMissingCheckoutOccurrencesForMonth,
} from './discipline.helper';

const issueMock = issueAutoTemplatedLetter as jest.MockedFunction<
  typeof issueAutoTemplatedLetter
>;

const EMP_ID = 'emp-mc-occ';

type FakeEvent = {
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
};

function makeTx(seed?: { letters?: FakeLetter[] }) {
  let events: FakeEvent[] = [];
  const letters = seed?.letters ?? [];
  let letterSeq = 0;

  const tx = {
    employee: {
      findUnique: jest.fn(async () => ({
        id: EMP_ID,
        dutyStartTime: '09:00',
        dutyEndTime: '21:00',
      })),
    },
    stipendRecord: {
      findFirst: jest.fn(async () => ({
        id: 'sr-1',
        employeeId: EMP_ID,
        basicStipend: 31000,
        effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
        effectiveTo: null,
      })),
    },
    payrollEntry: {
      findUnique: jest.fn(async () => ({
        id: 'pe-1',
        stipendRecordId: 'sr-1',
        month: 8,
        year: 2026,
        status: 'PENDING',
        totalDeductions: 0,
        netStipend: 31000,
      })),
      create: jest.fn(),
      update: jest.fn(async () => ({})),
    },
    payrollDeduction: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
    },
    letter: {
      findMany: jest.fn(async () => letters),
    },
    disciplineEvent: {
      count: jest.fn(
        async (args: {
          where: {
            employeeId: string;
            category: string;
            incidentDate: { gte: Date; lt: Date };
          };
        }) => {
          const gte = args.where.incidentDate.gte.toISOString().slice(0, 10);
          const lt = args.where.incidentDate.lt.toISOString().slice(0, 10);
          return events.filter(
            (e) =>
              e.employeeId === args.where.employeeId &&
              e.category === args.where.category &&
              e.incidentDate >= gte &&
              e.incidentDate < lt,
          ).length;
        },
      ),
      findMany: jest.fn(
        async (args: {
          where: {
            employeeId: string;
            category: string;
            incidentDate: { gte: Date; lte: Date };
          };
        }) => {
          const gte = args.where.incidentDate.gte.toISOString().slice(0, 10);
          const lte = args.where.incidentDate.lte.toISOString().slice(0, 10);
          return events
            .filter(
              (e) =>
                e.employeeId === args.where.employeeId &&
                e.category === args.where.category &&
                e.incidentDate >= gte &&
                e.incidentDate <= lte,
            )
            .sort((a, b) => a.incidentDate.localeCompare(b.incidentDate))
            .map((e) => ({ id: e.id, occurrence: e.occurrence }));
        },
      ),
      findUnique: jest.fn(
        async (args: {
          where: {
            employeeId_category_incidentDate: {
              employeeId: string;
              category: string;
              incidentDate: Date;
            };
          };
        }) => {
          const key = args.where.employeeId_category_incidentDate;
          const d = key.incidentDate.toISOString().slice(0, 10);
          const e = events.find(
            (row) =>
              row.employeeId === key.employeeId &&
              row.category === key.category &&
              row.incidentDate === d,
          );
          return e ? { occurrence: e.occurrence } : null;
        },
      ),
      update: jest.fn(
        async (args: { where: { id: string }; data: { occurrence: number } }) => {
          const e = events.find((row) => row.id === args.where.id);
          if (!e) throw new Error('missing event');
          e.occurrence = args.data.occurrence;
          return e;
        },
      ),
      create: jest.fn(
        async (args: {
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
          if (
            events.some(
              (e) =>
                e.employeeId === args.data.employeeId &&
                e.category === args.data.category &&
                e.incidentDate === incidentDate,
            )
          ) {
            const err = new Error('unique') as Error & { code: string };
            err.code = 'P2002';
            throw err;
          }
          const e: FakeEvent = {
            id: `de-${events.length + 1}`,
            employeeId: args.data.employeeId,
            category: args.data.category,
            incidentDate,
            occurrence: args.data.occurrence,
          };
          events.push(e);
          return e;
        },
      ),
    },
  };

  // Capture issued letters into the in-memory list for idempotency checks.
  issueMock.mockImplementation(async (_db, input) => {
    letterSeq += 1;
    const row: FakeLetter = {
      id: `L-${letterSeq}`,
      letterType: input.letterType,
      generatedAt: new Date(),
      variables: { ...(input.extraFields ?? {}) },
    };
    letters.push(row);
    return row as never;
  });

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    getEvents: () =>
      [...events].sort((a, b) => a.incidentDate.localeCompare(b.incidentDate)),
    getLetters: () => letters,
  };
}

const opts = (day: string) => ({
  checkIn: new Date(`${day}T04:00:00.000Z`),
  dutyEndTime: '21:00',
});

beforeEach(() => {
  issueMock.mockClear();
});

describe('missing-checkout chronological occurrence', () => {
  it('normal sequence: 1 Advice, 2 Warning, 3 Fine, 4 Advice', async () => {
    const { tx, getEvents } = makeTx();
    const days = ['2026-08-05', '2026-08-10', '2026-08-14', '2026-08-21'];

    for (const day of days) {
      await applyMissingCheckoutDiscipline(
        tx,
        EMP_ID,
        new Date(`${day}T00:00:00.000Z`),
        opts(day),
      );
    }

    expect(getEvents().map((e) => [e.incidentDate, e.occurrence])).toEqual([
      ['2026-08-05', 1],
      ['2026-08-10', 2],
      ['2026-08-14', 3],
      ['2026-08-21', 4],
    ]);

    const types = issueMock.mock.calls.map((c) => c[1].letterType);
    expect(types).toEqual([
      LetterType.ADVICE,
      LetterType.WARNING,
      LetterType.FINE,
      LetterType.ADVICE,
    ]);

    const occs = issueMock.mock.calls.map(
      (c) => c[1].extraFields?.monthlyMissingCheckoutOccurrence,
    );
    expect(occs).toEqual([1, 2, 3, 4]);
  });

  it('repair in random order still ends with chronological occurrences', async () => {
    const { tx, getEvents } = makeTx();
    const order = ['2026-08-20', '2026-08-05', '2026-08-15', '2026-08-10'];

    for (const day of order) {
      await applyMissingCheckoutDiscipline(
        tx,
        EMP_ID,
        new Date(`${day}T00:00:00.000Z`),
        opts(day),
      );
    }

    expect(getEvents().map((e) => [e.incidentDate, e.occurrence])).toEqual([
      ['2026-08-05', 1],
      ['2026-08-10', 2],
      ['2026-08-15', 3],
      ['2026-08-20', 4],
    ]);
  });

  it('idempotent: second apply for same date creates no new event or letter', async () => {
    const { tx, getEvents, getLetters } = makeTx();
    const day = new Date('2026-08-17T00:00:00.000Z');

    await applyMissingCheckoutDiscipline(tx, EMP_ID, day, opts('2026-08-17'));
    await applyMissingCheckoutDiscipline(tx, EMP_ID, day, opts('2026-08-17'));

    expect(getEvents()).toHaveLength(1);
    expect(getLetters()).toHaveLength(1);
    expect(issueMock).toHaveBeenCalledTimes(1);
  });

  it('does not reset when earlier claims exist even if attendance is closed', async () => {
    // Simulates: Aug 17 claimed (then checkout filled), Aug 21 still open.
    // Old bug counted only currently-open rows → Aug 21 got occurrence 1.
    const { tx, getEvents } = makeTx();

    await applyMissingCheckoutDiscipline(
      tx,
      EMP_ID,
      new Date('2026-08-17T00:00:00.000Z'),
      opts('2026-08-17'),
    );
    await applyMissingCheckoutDiscipline(
      tx,
      EMP_ID,
      new Date('2026-08-21T00:00:00.000Z'),
      opts('2026-08-21'),
    );

    expect(getEvents().map((e) => [e.incidentDate, e.occurrence])).toEqual([
      ['2026-08-17', 1],
      ['2026-08-21', 2],
    ]);
    expect(issueMock.mock.calls[1][1].letterType).toBe(LetterType.WARNING);
  });

  it('renumber helper is idempotent', async () => {
    const { tx, getEvents } = makeTx();
    for (const day of ['2026-08-05', '2026-08-10']) {
      await applyMissingCheckoutDiscipline(
        tx,
        EMP_ID,
        new Date(`${day}T00:00:00.000Z`),
        opts(day),
      );
    }
    const first = await renumberMissingCheckoutOccurrencesForMonth(
      tx,
      EMP_ID,
      new Date('2026-08-05T00:00:00.000Z'),
    );
    const second = await renumberMissingCheckoutOccurrencesForMonth(
      tx,
      EMP_ID,
      new Date('2026-08-05T00:00:00.000Z'),
    );
    expect(first.updated).toBe(0);
    expect(second.updated).toBe(0);
    expect(getEvents().map((e) => e.occurrence)).toEqual([1, 2]);
  });
});
