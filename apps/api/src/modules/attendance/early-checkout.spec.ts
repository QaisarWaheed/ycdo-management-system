jest.mock('../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn(),
}));

import { AttendanceStatus, LetterType } from '@prisma/client';
import { issueAutoTemplatedLetter } from '../letters/auto-letter.helper';
import { classifyDutyCheckout } from './checkout-classification.util';
import {
  applyEarlyCheckoutDiscipline,
  applyMissingCheckoutDiscipline,
  isEarlyCheckoutEligibleForDiscipline,
  isMissingCheckoutEligibleForDiscipline,
  MISSING_CHECKOUT_AUTO_NOTE,
  reconcileAttendanceFinancialConsequences,
  reverseEarlyCheckoutDisciplineForDate,
} from './discipline.helper';
import { calculateCardSalary } from '../payroll/attendance-card-salary.util';

const EMP = 'emp-1';
const day = (d: number) => new Date(Date.UTC(2026, 9, d));
const pkt = (d: number, hhmm: string) =>
  new Date(`2026-10-${String(d).padStart(2, '0')}T${hhmm}:00+05:00`);

/** Minimal in-memory Prisma transaction for the dated discipline track. */
function fakeTx() {
  const events: Array<{
    id: string;
    category: string;
    incidentDate: Date;
    occurrence: number;
  }> = [];
  const letters: Array<{
    id: string;
    letterType: LetterType;
    generatedAt: Date;
    variables: Record<string, unknown>;
  }> = [];
  const suspensionDrafts: unknown[] = [];
  const inMonth = (
    d: Date,
    where: { incidentDate?: { gte?: Date; lt?: Date; lte?: Date } },
  ) =>
    (!where.incidentDate?.gte || d >= where.incidentDate.gte) &&
    (!where.incidentDate?.lt || d < where.incidentDate.lt) &&
    (!where.incidentDate?.lte || d <= where.incidentDate.lte);
  const tx: any = {
    employee: {
      findUnique: jest.fn(async () => ({
        id: EMP,
        weeklyOffWeekdays: [],
        shift: null,
        dutyStartTime: '09:00',
        dutyEndTime: '17:00',
      })),
    },
    disciplineEvent: {
      create: jest.fn(async ({ data }: any) => {
        if (
          events.some(
            (e) =>
              e.category === data.category &&
              e.incidentDate.getTime() === data.incidentDate.getTime(),
          )
        ) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        events.push({ id: `ev-${events.length}`, ...data });
        return {};
      }),
      count: jest.fn(
        async ({ where }: any) =>
          events.filter(
            (e) =>
              e.category === where.category && inMonth(e.incidentDate, where),
          ).length,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        events
          .filter(
            (e) =>
              e.category === where.category && inMonth(e.incidentDate, where),
          )
          .sort((a, b) => a.incidentDate.getTime() - b.incidentDate.getTime()),
      ),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(events.find((e) => e.id === where.id)!, data),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where.employeeId_category_incidentDate;
        return (
          events.find(
            (e) =>
              e.category === k.category &&
              e.incidentDate.getTime() === k.incidentDate.getTime(),
          ) ?? null
        );
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = events.length;
        for (let i = events.length - 1; i >= 0; i--) {
          if (
            events[i].category === where.category &&
            events[i].incidentDate.getTime() === where.incidentDate.getTime()
          )
            events.splice(i, 1);
        }
        return { count: before - events.length };
      }),
    },
    letter: {
      findMany: jest.fn(async ({ where }: any) =>
        letters.filter((l) =>
          where.letterType?.in
            ? where.letterType.in.includes(l.letterType)
            : !where.letterType || l.letterType === where.letterType,
        ),
      ),
      create: jest.fn(async ({ data }: any) => {
        suspensionDrafts.push(data);
        return data;
      }),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(letters.find((l) => l.id === where.id)!, data),
      ),
    },
    stipendRecord: {
      findFirst: jest.fn(async () => ({ id: 'sr', basicStipend: 31000 })),
    },
    payrollEntry: { findUnique: jest.fn(async () => null) },
    disciplinaryAction: { create: jest.fn(async () => ({})) },
    user: { findMany: jest.fn(async () => []) },
    notification: { create: jest.fn(async () => ({})) },
  };
  jest
    .mocked(issueAutoTemplatedLetter)
    .mockImplementation(async (_db: any, input: any) => {
      letters.push({
        id: `l-${letters.length}`,
        letterType: input.letterType,
        generatedAt: new Date(),
        variables: input.extraFields,
      });
      return {} as any;
    });
  return { tx, events, letters, suspensionDrafts };
}

beforeEach(() => jest.mocked(issueAutoTemplatedLetter).mockReset());

describe('classifyDutyCheckout — early checkout is separate from lateness', () => {
  const employee = {
    dutyStartTime: '09:00',
    dutyEndTime: '17:00',
    dutyTotalHours: 8,
    shift: null,
  };
  const log = (checkIn: string) => ({
    date: day(10),
    status: AttendanceStatus.PRESENT,
    checkIn: pkt(10, checkIn),
  });

  it('on time + leaves 60 min early: PRESENT, no late minutes, 60 early-out minutes', () => {
    expect(
      classifyDutyCheckout(log('09:00'), employee, pkt(10, '16:00')),
    ).toEqual({
      lateMinutes: 0,
      earlyOutMinutes: 60,
      status: AttendanceStatus.PRESENT,
    });
  });
  it('leaving within the 15-minute grace is not an early checkout', () => {
    expect(
      classifyDutyCheckout(log('09:00'), employee, pkt(10, '16:45'))
        .earlyOutMinutes,
    ).toBe(0);
    expect(
      classifyDutyCheckout(log('09:00'), employee, pkt(10, '16:44'))
        .earlyOutMinutes,
    ).toBe(16);
  });
  it('late in and early out on the same day count once in each track', () => {
    expect(
      classifyDutyCheckout(log('09:45'), employee, pkt(10, '16:00')),
    ).toEqual({
      lateMinutes: 30,
      earlyOutMinutes: 60,
      status: AttendanceStatus.LATE,
    });
  });
  it('a 3-hour early checkout never becomes a Half Day', () => {
    expect(
      classifyDutyCheckout(log('09:00'), employee, pkt(10, '14:00')),
    ).toEqual({
      lateMinutes: 0,
      earlyOutMinutes: 180,
      status: AttendanceStatus.PRESENT,
    });
  });
});

describe('early checkout letter cycle', () => {
  it('Advice, Warning, Fine, repeating, and a suspension draft at the 9th', async () => {
    const { tx, letters, suspensionDrafts } = fakeTx();
    for (let d = 1; d <= 9; d++) {
      await applyEarlyCheckoutDiscipline(tx, EMP, day(d), {
        checkOut: pkt(d, '16:00'),
        earlyOutMinutes: 60,
      });
    }
    expect(letters.map((l) => l.letterType)).toEqual([
      LetterType.ADVICE,
      LetterType.WARNING,
      LetterType.FINE,
      LetterType.ADVICE,
      LetterType.WARNING,
      LetterType.FINE,
      LetterType.ADVICE,
      LetterType.WARNING,
    ]);
    expect(
      letters.every((l) => l.variables.disciplineCategory === 'EARLY_CHECKOUT'),
    ).toBe(true);
    expect(
      letters.map((l) => l.variables.monthlyEarlyCheckoutOccurrence),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(letters.some((l) => 'monthlyLateOccurrence' in l.variables)).toBe(
      false,
    );
    expect(suspensionDrafts).toHaveLength(1);
    expect(suspensionDrafts[0]).toMatchObject({
      letterType: LetterType.SUSPENSION,
    });
  });

  it('letter shows real duty end, actual checkout and minutes early (never an invented arrival time)', async () => {
    const { tx, letters } = fakeTx();
    await applyEarlyCheckoutDiscipline(tx, EMP, day(3), {
      checkOut: pkt(3, '16:00'),
      earlyOutMinutes: 60,
    });
    const text = String(letters[0].variables.violations);
    expect(text).toContain('17:00');
    expect(text).toContain('16:00');
    expect(text).toContain('60 منٹ');
    expect(text).not.toContain('حاضری کا اصل وقت');
  });

  it('is idempotent per date', async () => {
    const { tx, letters, events } = fakeTx();
    await applyEarlyCheckoutDiscipline(tx, EMP, day(5), {
      checkOut: pkt(5, '16:00'),
      earlyOutMinutes: 60,
    });
    await applyEarlyCheckoutDiscipline(tx, EMP, day(5), {
      checkOut: pkt(5, '16:00'),
      earlyOutMinutes: 60,
    });
    expect(letters).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('reversal voids the letter and releases the claim (e.g. Short Leave approved)', async () => {
    const { tx, letters, events } = fakeTx();
    await applyEarlyCheckoutDiscipline(tx, EMP, day(6), {
      checkOut: pkt(6, '16:00'),
      earlyOutMinutes: 60,
    });
    const result = await reverseEarlyCheckoutDisciplineForDate(
      tx,
      EMP,
      day(6),
      'SHORT_LEAVE_APPROVED',
    );
    expect(result.reversed).toBe(true);
    expect(letters[0].variables).toMatchObject({
      reversed: true,
      reversalTrigger: 'SHORT_LEAVE_APPROVED',
    });
    expect(events).toHaveLength(0);
  });

  it('reconcile applies on entering and reverses on leaving the early-checkout state', async () => {
    const { tx, letters } = fakeTx();
    const before = {
      status: AttendanceStatus.PRESENT,
      lateMinutes: 0,
      earlyOutMinutes: 0,
      checkIn: pkt(7, '09:00'),
      checkOut: null,
    };
    const early = { ...before, checkOut: pkt(7, '16:00'), earlyOutMinutes: 60 };
    await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMP,
      date: day(7),
      before,
      after: early,
    });
    expect(letters).toHaveLength(1);
    await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMP,
      date: day(7),
      before: early,
      after: { ...early, checkOut: pkt(7, '17:00'), earlyOutMinutes: 0 },
    });
    expect(letters[0].variables.reversed).toBe(true);
  });

  it('eligibility needs a checkout, early minutes and a worked status', () => {
    const base = {
      status: AttendanceStatus.PRESENT,
      checkOut: pkt(1, '16:00'),
      earlyOutMinutes: 30,
    };
    expect(isEarlyCheckoutEligibleForDiscipline(base)).toBe(true);
    expect(
      isEarlyCheckoutEligibleForDiscipline({ ...base, earlyOutMinutes: 0 }),
    ).toBe(false);
    expect(
      isEarlyCheckoutEligibleForDiscipline({ ...base, checkOut: null }),
    ).toBe(false);
    expect(
      isEarlyCheckoutEligibleForDiscipline({
        ...base,
        status: AttendanceStatus.SHORT_LEAVE,
      }),
    ).toBe(false);
  });
});

describe('payroll: early checkout has its own every-3 rule', () => {
  const card = {
    calendarDays: 31,
    present: 31,
    absent: 0,
    uninformedAbsent: 0,
    late: 0,
    halfDay: 0,
    shortLeave: 0,
    onLeave: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    holiday: 0,
    swapCovered: 0,
    unmarked: 0,
    additionalWorkingDays: 0,
    overtimeHours: 0,
  };
  it('3 early checkouts = one day; they never feed the late penalty', () => {
    const salary = calculateCardSalary({ ...card, earlyCheckout: 3 }, 31000, 8);
    expect(salary.earlyCheckoutPenalty).toBe(1000);
    expect(salary.latePenalty).toBe(0);
    expect(salary.paidDays).toBe(31);
    expect(salary.attendanceSalary).toBe(30000);
  });
  it('2 early checkouts deduct nothing', () => {
    expect(
      calculateCardSalary({ ...card, earlyCheckout: 2 }, 31000, 8)
        .earlyCheckoutPenalty,
    ).toBe(0);
  });
});

describe('missed checkout — same cycle as late and early checkout', () => {
  it('Advice, Warning, Fine, repeating, suspension draft at the 9th', async () => {
    const { tx, letters, suspensionDrafts } = fakeTx();
    for (let d = 1; d <= 9; d++) {
      await applyMissingCheckoutDiscipline(tx, EMP, day(d), {
        checkIn: pkt(d, '09:00'),
        dutyEndTime: '17:00',
      });
    }
    expect(letters.map((l) => l.letterType)).toEqual([
      LetterType.ADVICE,
      LetterType.WARNING,
      LetterType.FINE,
      LetterType.ADVICE,
      LetterType.WARNING,
      LetterType.FINE,
      LetterType.ADVICE,
      LetterType.WARNING,
    ]);
    expect(
      letters.map((l) => l.variables.monthlyMissingCheckoutOccurrence),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(suspensionDrafts).toHaveLength(1);
    expect(suspensionDrafts[0]).toMatchObject({
      letterType: LetterType.SUSPENSION,
    });
  });

  it('an auto-closed day still counts until a real checkout replaces it', () => {
    const autoClosed = {
      checkIn: pkt(2, '09:00'),
      checkOut: pkt(2, '17:00'),
      note: MISSING_CHECKOUT_AUTO_NOTE,
    };
    expect(isMissingCheckoutEligibleForDiscipline(autoClosed)).toBe(true);
    expect(
      isMissingCheckoutEligibleForDiscipline({ ...autoClosed, note: '' }),
    ).toBe(false);
    expect(
      isMissingCheckoutEligibleForDiscipline({
        checkIn: pkt(2, '09:00'),
        checkOut: null,
      }),
    ).toBe(true);
  });

  it('HR entering the real checkout reverses that day letter', async () => {
    const { tx, letters, events } = fakeTx();
    await applyMissingCheckoutDiscipline(tx, EMP, day(4), {
      checkIn: pkt(4, '09:00'),
      dutyEndTime: '17:00',
    });
    const autoClosed = {
      status: AttendanceStatus.PRESENT,
      lateMinutes: 0,
      checkIn: pkt(4, '09:00'),
      checkOut: pkt(4, '17:00'),
      note: MISSING_CHECKOUT_AUTO_NOTE,
    };
    await reconcileAttendanceFinancialConsequences(tx, {
      employeeId: EMP,
      date: day(4),
      before: autoClosed,
      after: { ...autoClosed, checkOut: pkt(4, '17:10'), note: '' },
    });
    expect(letters[0].variables.reversed).toBe(true);
    expect(
      events.filter((e) => e.category === 'MISSING_CHECKOUT'),
    ).toHaveLength(0);
  });

  it('payroll: every 3 missed checkouts = one day, separate from late', () => {
    const card = {
      calendarDays: 31,
      present: 31,
      absent: 0,
      uninformedAbsent: 0,
      late: 0,
      halfDay: 0,
      shortLeave: 0,
      onLeave: 0,
      paidLeaveDays: 0,
      unpaidLeaveDays: 0,
      holiday: 0,
      swapCovered: 0,
      unmarked: 0,
      additionalWorkingDays: 0,
      overtimeHours: 0,
    };
    const salary = calculateCardSalary(
      { ...card, missingCheckout: 4 },
      31000,
      8,
    );
    expect(salary.missingCheckoutPenalty).toBe(1000);
    expect(salary.latePenalty).toBe(0);
    expect(salary.attendanceSalary).toBe(30000);
  });
});
