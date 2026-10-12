import { AttendanceStatus } from '@prisma/client';
import { calculateCardSalary } from './attendance-card-salary.util';
import { loadAttendanceCard } from '../attendance/attendance-card.util';

const day = (d: number) => new Date(Date.UTC(2026, 8, d));

describe('leave pay percentage (HR choice)', () => {
  it('a 50% leave day pays half a day of basic', () => {
    const base = {
      calendarDays: 30,
      present: 20,
      absent: 0,
      uninformedAbsent: 0,
      late: 0,
      halfDay: 0,
      shortLeave: 0,
      holiday: 4,
      swapCovered: 0,
      unmarked: 0,
      additionalWorkingDays: 0,
      overtimeHours: 0,
    };
    const full = calculateCardSalary(
      {
        ...base,
        onLeave: 6,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        halfPaidLeaveDays: 6,
      },
      30000,
      8,
    );
    // 20 present + 4 holiday + 6 × 0.5 = 27 paid days of 1,000
    expect(full.paidDays).toBe(27);
    expect(full.earnedBasic).toBe(27000);
  });

  it('splits leave days by pay %; days without a % follow the monthly quota', async () => {
    const logs = [
      { date: day(1), status: AttendanceStatus.PRESENT, payPercent: null },
      // medical leave at 50%
      { date: day(2), status: AttendanceStatus.ON_LEAVE, payPercent: 50 },
      { date: day(3), status: AttendanceStatus.ON_LEAVE, payPercent: 50 },
      // marriage leave HR marked full pay (outside the quota)
      { date: day(4), status: AttendanceStatus.ON_LEAVE, payPercent: 100 },
      // without pay
      { date: day(5), status: AttendanceStatus.ON_LEAVE, payPercent: 0 },
      // normal leave: quota of 1 → one paid, one unpaid
      { date: day(6), status: AttendanceStatus.ON_LEAVE, payPercent: null },
      { date: day(7), status: AttendanceStatus.ON_LEAVE, payPercent: null },
    ].map((l) => ({
      ...l,
      overtimeMinutes: 0,
      lateMinutes: 0,
      earlyOutMinutes: 0,
      overtimePending: false,
      overtimeApprovedAt: null,
    }));
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          joiningDate: null,
          status: 'ACTIVE',
          statusEffectiveFrom: null,
          monthlyAllowedLeaves: 1,
        }),
      },
      attendanceLog: { findMany: jest.fn().mockResolvedValue(logs) },
      additionalWorkingDay: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const card = await loadAttendanceCard(prisma as never, 'e1', 9, 2026);
    expect(card.onLeave).toBe(6);
    expect(card.halfPaidLeaveDays).toBe(2);
    expect(card.paidLeaveDays).toBe(2); // full-pay day + 1 quota day
    expect(card.unpaidLeaveDays).toBe(2); // without-pay day + 1 over quota
    expect(card.paidLeaveDateKeys).toEqual(
      expect.arrayContaining(['2026-09-04', '2026-09-06']),
    );
    expect(card.halfPaidLeaveDateKeys).toEqual(['2026-09-02', '2026-09-03']);
    // still consistent for the salary arithmetic
    expect(() => calculateCardSalary(card as never, 30000, 8)).not.toThrow();
  });
});
