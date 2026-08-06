import { getDutyWindow } from '../../common/duty.util';
import {
  buildHourlyPayrollBreakdown,
  computeHourlyRate,
  leaveCreditMinutes,
  payableMinutesWithinDutyWindow,
  resolveDailyDutyHours,
  splitPaidUnpaidLeaveDays,
  unpaidLeaveDeductionAmount,
} from './payroll-hours.util';

/** Build a Date whose Pakistan local clock matches the given HH:mm on 2026-07-01. */
function pkTime(hours: number, minutes = 0): Date {
  // PK = UTC+5 → UTC = PK - 5h
  return new Date(Date.UTC(2026, 6, 1, hours - 5, minutes, 0));
}

describe('payroll-hours.util', () => {
  it('computes hourly rate from basic stipend and scheduled hours', () => {
    expect(computeHourlyRate(30000, 8, 30)).toBe(125);
    expect(computeHourlyRate(0, 8, 30)).toBe(0);
  });

  it('resolves daily duty hours from duty window', () => {
    expect(
      resolveDailyDutyHours({
        dutyStartTime: '08:00',
        dutyEndTime: '16:00',
      }),
    ).toBe(8);

    expect(
      resolveDailyDutyHours({
        dutyStartTime: '20:00',
        dutyEndTime: '08:00',
      }),
    ).toBe(12);
  });

  it('credits only minutes inside the duty window', () => {
    const win = getDutyWindow({
      dutyStartTime: '08:00',
      dutyEndTime: '16:00',
    });

    // Early 07:00–16:00 → only 08:00–16:00 payable (480)
    const early = payableMinutesWithinDutyWindow(
      pkTime(7, 0),
      pkTime(16, 0),
      win,
    );
    expect(early.anomalous).toBe(false);
    expect(early.minutes).toBe(480);

    // Late arrival 09:00–16:00 → 420
    const late = payableMinutesWithinDutyWindow(
      pkTime(9, 0),
      pkTime(16, 0),
      win,
    );
    expect(late.minutes).toBe(420);

    // Stay after duty 08:00–17:00 → still 480 (post-duty excluded)
    const overtime = payableMinutesWithinDutyWindow(
      pkTime(8, 0),
      pkTime(17, 0),
      win,
    );
    expect(overtime.minutes).toBe(480);
  });

  it('handles cross-midnight duty windows', () => {
    const win = getDutyWindow({
      dutyStartTime: '20:00',
      dutyEndTime: '08:00',
    });

    const session = payableMinutesWithinDutyWindow(
      pkTime(20, 0),
      new Date(Date.UTC(2026, 6, 2, 3, 0, 0)), // 08:00 PK next day
      win,
    );
    expect(session.anomalous).toBe(false);
    expect(session.minutes).toBe(720);
  });

  it('credits full and short leave hours', () => {
    expect(leaveCreditMinutes('ON_LEAVE', 'Approved leave', 480)).toBe(480);
    expect(leaveCreditMinutes('HALF_DAY', 'Approved short leave', 480)).toBe(
      240,
    );
    expect(leaveCreditMinutes('HALF_DAY', 'Late arrival', 480)).toBe(0);
    expect(leaveCreditMinutes('LATE', null, 480)).toBe(0);
  });

  it('builds hourly payroll breakdown with fixed components and penalties', () => {
    const breakdown = buildHourlyPayrollBreakdown({
      contractualBasicStipend: 30000,
      dailyDutyHours: 8,
      daysInMonth: 30,
      workedMinutes: 480 * 20, // 20 full days
      paidLeaveMinutes: 480 * 2, // 2 leave days
      fixedAllowances: 5000,
      fixedPackageDeductions: 1000,
      disciplineDeductions: 1000, // one 3-late penalty
      extraAllowances: 500, // OT
    });

    expect(breakdown.hourlyRate).toBe(125);
    expect(breakdown.payableHours).toBe(176);
    expect(breakdown.hourlyBasicEarned).toBe(22000);
    expect(breakdown.netStipend).toBe(22000 + 5000 + 500 - 1000 - 1000);
  });

  it('splits paid vs unpaid leave for 3 allowed / 5 taken', () => {
    const dates = [1, 2, 3, 4, 5].map((d) => new Date(2026, 5, d));
    const split = splitPaidUnpaidLeaveDays({
      onLeaveDates: dates,
      monthlyAllowedLeaves: 3,
    });
    expect(split.leaveDays).toBe(5);
    expect(split.paidLeaveDays).toBe(3);
    expect(split.unpaidLeaveDays).toBe(2);
    expect(split.paidLeaveDateKeys.size).toBe(3);
    expect(split.paidLeaveDateKeys.has('2026-06-01')).toBe(true);
    expect(split.paidLeaveDateKeys.has('2026-06-03')).toBe(true);
    expect(split.paidLeaveDateKeys.has('2026-06-04')).toBe(false);

    expect(unpaidLeaveDeductionAmount(2, 30000, 30)).toBe(2000);
  });

  it('treats null monthlyAllowedLeaves as unlimited paid leave', () => {
    const dates = [1, 2, 3, 4, 5].map((d) => new Date(2026, 5, d));
    const split = splitPaidUnpaidLeaveDays({
      onLeaveDates: dates,
      monthlyAllowedLeaves: null,
    });
    expect(split.paidLeaveDays).toBe(5);
    expect(split.unpaidLeaveDays).toBe(0);
    expect(unpaidLeaveDeductionAmount(0, 30000, 30)).toBe(0);
  });
});
