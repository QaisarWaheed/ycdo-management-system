import { AllowanceProration } from '@prisma/client';
import { prorateMonthlyPackageAmount } from '../../common/stipend.util';
import {
  computePackageAllowanceLines,
  isActiveInMonth,
  usesAllowanceTable,
} from './package-allowances.util';
import {
  buildPayslipSections,
  computeEarningsTotal,
  type PayslipSlipData,
} from '../payroll/payslip-slip.util';

const FULL = AllowanceProration.FULL_MONTH;
const ATT = AllowanceProration.ATTENDANCE;

describe('package allowances', () => {
  it('switches to the allowance table from November 2026 only', () => {
    expect(usesAllowanceTable(2026, 10)).toBe(false);
    expect(usesAllowanceTable(2026, 11)).toBe(true);
    expect(usesAllowanceTable(2027, 1)).toBe(true);
  });

  it('treats start and end months as inclusive', () => {
    const row = {
      startMonth: new Date(Date.UTC(2026, 10, 1)),
      endMonth: new Date(Date.UTC(2026, 10, 1)),
    };
    expect(isActiveInMonth(row, 2026, 10)).toBe(false);
    expect(isActiveInMonth(row, 2026, 11)).toBe(true);
    expect(isActiveInMonth(row, 2026, 12)).toBe(false);
    expect(isActiveInMonth({ ...row, endMonth: null }, 2027, 6)).toBe(true);
  });

  it('gives the same total as the old four-field formula for a mid-month joiner', () => {
    // Old: prorate(allowances + reward + progressReward + fuel) in one go.
    const amounts = {
      allowances: 5000,
      reward: 1333.33,
      progressReward: 777,
      fuel: 3000,
    };
    const prorate = (monthlyAmount: number) =>
      prorateMonthlyPackageAmount({
        monthlyAmount,
        year: 2026,
        month: 11,
        segmentStart: new Date('2026-10-31T19:00:00.000Z'),
        segmentEndExclusive: null,
        monthEnd: new Date('2026-11-30T19:00:00.000Z'),
        employmentStart: new Date('2026-11-17T00:00:00.000Z'),
        employmentEndExclusive: null,
      });
    const oldTotal = prorate(
      amounts.allowances +
        amounts.reward +
        amounts.progressReward +
        amounts.fuel,
    );
    const { lines, total } = computePackageAllowanceLines(
      [
        {
          name: 'Travelling Exp',
          proration: FULL,
          amount: amounts.allowances,
          sortOrder: 10,
        },
        {
          name: 'Reward',
          proration: FULL,
          amount: amounts.reward,
          sortOrder: 20,
        },
        {
          name: 'Reward On Progress',
          proration: FULL,
          amount: amounts.progressReward,
          sortOrder: 30,
        },
        {
          name: 'Petrol',
          proration: FULL,
          amount: amounts.fuel,
          sortOrder: 40,
        },
      ],
      { prorate, paidDays: 10, calendarDays: 30 },
    );
    expect(oldTotal).toBeLessThan(10110.33);
    expect(total).toBeCloseTo(oldTotal, 6);
    expect(lines.map((l) => l.label)).toEqual([
      'Travelling Exp',
      'Reward',
      'Reward On Progress',
      'Petrol',
    ]);
  });

  it('pays attendance types by paid days and drops zero lines', () => {
    const { lines, total } = computePackageAllowanceLines(
      [
        { name: 'Pharmacy', proration: FULL, amount: 2000 },
        { name: 'Night Monitoring', proration: ATT, amount: 3000 },
        { name: 'Audit', proration: ATT, amount: 1500 },
      ],
      { prorate: (a) => a, paidDays: 0, calendarDays: 30 },
    );
    expect(lines).toEqual([{ label: 'Pharmacy', amount: 2000 }]);
    expect(total).toBe(2000);

    const partial = computePackageAllowanceLines(
      [{ name: 'Night Monitoring', proration: ATT, amount: 3000 }],
      { prorate: (a) => a, paidDays: 12, calendarDays: 30 },
    );
    expect(partial.total).toBe(1200);
  });

  it('shows each allowance on the payslip and still adds up to the earnings total', () => {
    const earnings: PayslipSlipData['earnings'] = {
      stipend: 30000,
      contractualStipend: 30000,
      previousMonth: 0,
      rewardOnProgress: 0,
      rewards: 0,
      // package lines 2000 + 1200 + incentive 500
      otherAllowance: 3700,
      fuel: 0,
      mobileLoad: 0,
      extraDuty: 0,
    };
    const sections = buildPayslipSections({
      earnings,
      deductions: {
        advance: 0,
        loan: 0,
        mobileLoad: 0,
        absence: 0,
        fine: 0,
        lateHour: 0,
        health: 0,
        providentFund: 0,
        tax: 0,
        auditDifference: 0,
        staffPendingMed: 0,
        kitchenPending: 0,
        electricityBill: 0,
        mobileBill: 0,
        other: 0,
      },
      deductionRows: [],
      allowanceRows: [{ type: 'CUSTOM', amount: 500, description: 'Incentive: On Progress' }],
      pkg: { allowances: 0, fineDeduction: 0 },
      packageLines: [
        { label: 'Pharmacy', amount: 2000 },
        { label: 'Night Monitoring', amount: 1200 },
      ],
      totalDays: 30,
    });
    const pay = sections.find((s) => s.key === 'earnings')!;
    expect(pay.lines).toEqual([
      { label: 'Basic Stipend', amount: 30000 },
      { label: 'Incentive', amount: 500, note: 'On Progress' },
      { label: 'Pharmacy', amount: 2000 },
      { label: 'Night Monitoring', amount: 1200 },
    ]);
    expect(pay.lines.reduce((s, l) => s + l.amount, 0)).toBe(
      computeEarningsTotal(earnings),
    );
  });
});
