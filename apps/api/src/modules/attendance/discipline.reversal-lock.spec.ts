import { AttendanceStatus, LetterType, Prisma } from '@prisma/client';
jest.mock('../letters/auto-letter.helper', () => ({ issueAutoTemplatedLetter: jest.fn() }));
import {
  reconcileAttendanceFinancialConsequences,
  reverseAbsenceDeductionForDate,
  reverseLateDisciplineForDate,
  reverseMissingCheckoutDisciplineForDate,
} from './discipline.helper';

const date = new Date('2026-08-18T00:00:00.000Z');
const employeeId = 'emp-lock';
const reversals = [
  ['late', (tx: Prisma.TransactionClient) => reverseLateDisciplineForDate(tx, employeeId, date)],
  ['absence', (tx: Prisma.TransactionClient) => reverseAbsenceDeductionForDate(tx, employeeId, date)],
  ['missing checkout', (tx: Prisma.TransactionClient) => reverseMissingCheckoutDisciplineForDate(tx, employeeId, date)],
  ['half day', (tx: Prisma.TransactionClient) => reconcileAttendanceFinancialConsequences(tx, {
    employeeId, date,
    before: { status: AttendanceStatus.HALF_DAY, lateMinutes: 0 },
    after: { status: AttendanceStatus.PRESENT, lateMinutes: 0 },
  })],
] as const;

describe.each(reversals)('%s legacy reversal financial lock', (_name, reverse) => {
  it.each(['PENDING', 'PAID'])('reads financial state only after locking, observing %s after lock', async (statusAfterLock) => {
    const entry = { id: 'pe-1', status: 'PENDING' };
    const tx = {
      $queryRaw: jest.fn(async () => { entry.status = statusAfterLock; return [{ id: employeeId }]; }),
      stipendRecord: { findFirst: jest.fn(async () => ({ id: 'sr-1' })) },
      payrollEntry: { findUnique: jest.fn(async () => entry), update: jest.fn() },
      payrollDeduction: { findFirst: jest.fn(async () => ({ id: 'ded-1', amount: 1000 })), delete: jest.fn() },
      letter: {
        findMany: jest.fn(async () => [{ id: 'letter-1', letterType: LetterType.FINE, variables: {
          incidentDate: '2026-08-18', monthlyLateOccurrence: 3, monthlyMissingCheckoutOccurrence: 3,
        } }]),
        update: jest.fn(),
      },
      disciplineEvent: { deleteMany: jest.fn(async () => ({ count: 1 })), findMany: jest.fn(async () => []) },
    };
    await reverse(tx as unknown as Prisma.TransactionClient);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [sql, lockedEmployee] = tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, string];
    expect(sql.join('?')).toContain('FOR UPDATE');
    expect(lockedEmployee).toBe(employeeId);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.stipendRecord.findFirst.mock.invocationCallOrder[0]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.payrollEntry.findUnique.mock.invocationCallOrder[0]);
    expect(tx.payrollDeduction.delete).toHaveBeenCalledTimes(statusAfterLock === 'PAID' ? 0 : 1);
    expect(tx.payrollEntry.update).toHaveBeenCalledTimes(statusAfterLock === 'PAID' ? 0 : 1);
  });
});
