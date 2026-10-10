import { AttendanceStatus } from '@prisma/client';
import { buildPayslipDayDetails } from './payslip-day-details.util';
import { buildPayslipSections } from './payslip-slip.util';

const d = (day: number) => new Date(Date.UTC(2026, 8, day));
const log = (day: number, status: AttendanceStatus, extra = {}) => ({
  date: d(day),
  status,
  overtimeMinutes: 0,
  earlyOutMinutes: 0,
  ...extra,
});

// Joined 9 Sep: 8 days before joining; 2 unpaid leaves, 1 absent, 3 late, 3 holidays, 13 present.
const logs = [];
for (let day = 9; day <= 30; day++) {
  if (day === 13 || day === 20 || day === 27) logs.push(log(day, AttendanceStatus.HOLIDAY));
  else if (day === 15 || day === 16) logs.push(log(day, AttendanceStatus.ON_LEAVE));
  else if (day === 22) logs.push(log(day, AttendanceStatus.ABSENT));
  else if (day === 10 || day === 11 || day === 12)
    logs.push(log(day, AttendanceStatus.LATE, day === 10 ? { overtimeMinutes: 120 } : {}));
  else logs.push(log(day, AttendanceStatus.PRESENT, day === 23 ? { earlyOutMinutes: 30 } : {}));
}
const details = buildPayslipDayDetails({
  facts: {
    month: 9,
    year: 2026,
    logs,
    extraDays: [{ date: d(14), note: 'In place of Dr. Atika' }],
    missedCheckouts: [],
  },
  employee: { joiningDate: d(9), status: 'ACTIVE' },
  paidLeaveDateKeys: [],
  paidDays: 19,
  now: new Date('2026-10-11T00:00:00Z'),
});

describe('payslip day details', () => {
  it('accounts for every calendar day', () => {
    expect(details.breakdown).toMatchObject({
      totalDays: 30,
      beforeJoining: 8,
      joinedOn: '9 Sep',
      present: 13,
      late: 3,
      holiday: 3,
      unpaidLeave: 2,
      absent: 1,
      upcoming: 0,
      notMarked: 0,
      paidDays: 19,
    });
    expect(details.dates.late).toEqual(['10 Sep', '11 Sep', '12 Sep']);
    expect(details.dates.overtime).toEqual([{ date: '10 Sep', hours: 2 }]);
    expect(details.dates.earlyCheckout).toEqual(['23 Sep']);
  });

  it('in a running month today is "not yet", past gaps are "not marked"', () => {
    const running = buildPayslipDayDetails({
      facts: {
        month: 10,
        year: 2026,
        logs: [
          { date: new Date(Date.UTC(2026, 9, 9)), status: AttendanceStatus.PRESENT, overtimeMinutes: 0, earlyOutMinutes: 0 },
        ],
        extraDays: [],
        missedCheckouts: [],
      },
      employee: { joiningDate: new Date(Date.UTC(2026, 9, 9)), status: 'ACTIVE' },
      paidLeaveDateKeys: [],
      paidDays: 1,
      now: new Date('2026-10-11T06:00:00Z'),
    });
    expect(running.breakdown).toMatchObject({ beforeJoining: 8, present: 1, notMarked: 1, upcoming: 21 });
    expect(running.dates.notMarked).toEqual(['10 Oct']);
  });

  it('splits days not paid by cause and puts dates on the lines', () => {
    const sections = buildPayslipSections({
      earnings: {
        stipend: 30000, contractualStipend: 30000, previousMonth: 0,
        rewardOnProgress: 0, rewards: 0, otherAllowance: 500, fuel: 0,
        mobileLoad: 0, extraDuty: 1000,
      },
      deductions: {
        advance: 0, loan: 0, mobileLoad: 0, absence: 1000, fine: 0,
        lateHour: 1000, health: 0, providentFund: 0, tax: 0, auditDifference: 0,
        staffPendingMed: 0, kitchenPending: 0, electricityBill: 0, mobileBill: 0,
        other: 0, unpaidBasic: 11000,
      },
      deductionRows: [
        { reason: 'UNINFORMED_ABSENCE', amount: 1000, description: 'Attendance Card: additional absence penalty' },
        { reason: 'LATE_ARRIVAL', amount: 1000, description: 'Attendance Card: every 3 Late' },
      ],
      allowanceRows: [
        { type: 'OVERTIME', amount: 500, hours: 2 },
        { type: 'ADDITIONAL_WORKING_DAYS', amount: 1000 },
      ],
      pkg: { allowances: 0, fineDeduction: 0 },
      totalDays: 30,
      unpaidDays: 11,
      counts: { late: 3 },
      dayDetails: details,
    });
    const by = Object.fromEntries(sections.map((s) => [s.key, s.lines]));
    expect(by.earnings).toContainEqual({
      label: 'Extra Days', amount: 1000, note: '1 day: 14 Sep (In place of Dr. Atika)',
    });
    expect(by.earnings).toContainEqual({ label: 'Overtime', amount: 500, note: '2 hours: 10 Sep 2h' });
    expect(by.attendance).toEqual([
      { label: 'Before joining', amount: 8000, note: '8 days: joined 9 Sep' },
      { label: 'Unpaid leave', amount: 2000, note: '2 days: 15, 16 Sep' },
      { label: 'Absent', amount: 1000, note: '1 day: 22 Sep' },
      { label: 'Absence fine', amount: 1000, note: '1 absence: 22 Sep' },
      { label: 'Late', amount: 1000, note: '3 lates: 10, 11, 12 Sep (every 3 = 1 day)' },
    ]);
  });
});
