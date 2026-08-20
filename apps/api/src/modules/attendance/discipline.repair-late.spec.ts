import { AttendanceStatus, Prisma } from '@prisma/client';
import {
  repairLateDisciplineForPayrollMonth,
} from './discipline.helper';

jest.mock('./../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));

const EMP_ID = 'emp-repair-1';
const AUG_1 = new Date('2026-08-01T00:00:00.000Z');
const AUG_2 = new Date('2026-08-02T00:00:00.000Z');

function asTx(tx: object): Prisma.TransactionClient {
  return tx as unknown as Prisma.TransactionClient;
}

describe('repairLateDisciplineForPayrollMonth', () => {
  it('skips when occurrence claim already matches calendar position', async () => {
    const disciplineEventKeys = new Set<string>();
    const tx = {
      attendanceLog: {
        findMany: jest.fn().mockResolvedValue([
          { date: AUG_1, status: AttendanceStatus.LATE, lateMinutes: 10, note: null, dutyStartTimeSnapshot: '09:00' },
        ]),
      },
      disciplineEvent: {
        findFirst: jest.fn().mockResolvedValue({
          employeeId: EMP_ID,
          category: 'LATE',
          incidentDate: AUG_1,
          occurrence: 1,
        }),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      employee: { findUnique: jest.fn(), update: jest.fn() },
      letter: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      stipendRecord: { findFirst: jest.fn() },
      payrollEntry: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      payrollDeduction: { findFirst: jest.fn(), create: jest.fn() },
      user: { updateMany: jest.fn() },
      notification: { create: jest.fn() },
    };

    const result = await repairLateDisciplineForPayrollMonth(
      asTx(tx),
      EMP_ID,
      8,
      2026,
    );

    expect(result).toEqual({ applied: 0, repaired: 0, skipped: 1 });
    expect(tx.disciplineEvent.create).not.toHaveBeenCalled();
  });

  it('applies discipline when no claim exists', async () => {
    const disciplineEventKeys = new Set<string>();
    const tx = {
      attendanceLog: {
        findMany: jest.fn().mockResolvedValue([
          { date: AUG_1, status: AttendanceStatus.LATE, lateMinutes: 10, note: null, dutyStartTimeSnapshot: '09:00' },
          { date: AUG_2, status: AttendanceStatus.LATE, lateMinutes: 20, note: null, dutyStartTimeSnapshot: '09:00' },
        ]),
      },
      disciplineEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: { employeeId: string; category: string; incidentDate: Date } }) => {
          const key = `${data.employeeId}|${data.category}|${data.incidentDate.toISOString()}`;
          if (disciplineEventKeys.has(key)) {
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          }
          disciplineEventKeys.add(key);
          return Promise.resolve(data);
        }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: EMP_ID,
          dutyStartTime: '09:00',
          dutyEndTime: '21:00',
          shift: null,
        }),
        update: jest.fn(),
      },
      letter: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      stipendRecord: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'stipend-1',
          basicStipend: 27500,
          effectiveFrom: new Date('2026-01-01'),
          effectiveTo: null,
        }),
      },
      payrollEntry: {
        findUnique: jest.fn().mockResolvedValue({ id: 'pe-1', status: 'PENDING' }),
        create: jest.fn(),
        update: jest.fn(),
      },
      payrollDeduction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      user: { updateMany: jest.fn() },
      notification: { create: jest.fn() },
    };

    const result = await repairLateDisciplineForPayrollMonth(
      asTx(tx),
      EMP_ID,
      8,
      2026,
    );

    expect(result.applied).toBe(2);
    expect(tx.disciplineEvent.create).toHaveBeenCalledTimes(2);
  });
});
