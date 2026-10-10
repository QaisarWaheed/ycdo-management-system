import {
  buildPayslipSections,
  computeDeductionsTotal,
  computeEarningsTotal,
  type PayslipSlipData,
} from './payslip-slip.util';

const earnings: PayslipSlipData['earnings'] = {
  stipend: 25000,
  contractualStipend: 31000,
  previousMonth: 0,
  rewardOnProgress: 1000,
  rewards: 0,
  // package allowance 2000 + overtime 500 + incentive 1500
  otherAllowance: 4000,
  fuel: 3000,
  mobileLoad: 0,
  extraDuty: 2000,
};
const deductions: PayslipSlipData['deductions'] = {
  advance: 1000,
  loan: 0,
  mobileLoad: 0,
  absence: 800,
  // package fine 0 + manual fines 300 + 200 + inquiry fine 400 + early-checkout card 1000
  fine: 1900,
  lateHour: 1000,
  health: 0,
  providentFund: 0,
  tax: 0,
  auditDifference: 0,
  staffPendingMed: 500,
  kitchenPending: 0,
  electricityBill: 0,
  mobileBill: 0,
  other: 0,
};
const deductionRows = [
  { reason: 'FINE', amount: 300, fineReason: 'NO_UNIFORM' },
  { reason: 'FINE', amount: 200, fineReason: 'MOBILE_ON_DUTY' },
  {
    reason: 'DISCIPLINARY_FINE',
    amount: 400,
    description: 'Inquiry fine — case 12',
  },
  {
    reason: 'DISCIPLINARY_FINE',
    amount: 1000,
    description: 'Attendance Card: every 3 Early Checkout',
  },
];
const allowanceRows = [
  { type: 'OVERTIME', amount: 500 },
  { type: 'CUSTOM', amount: 1500 },
  { type: 'ADDITIONAL_WORKING_DAYS', amount: 2000 },
];

describe('buildPayslipSections', () => {
  const sections = buildPayslipSections({
    earnings,
    deductions,
    deductionRows,
    allowanceRows,
    pkg: { allowances: 2000, fineDeduction: 0 },
    totalDays: 31,
  });
  const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));
  const total = (key: string) =>
    byKey[key].lines.reduce(
      (s: number, l: { amount: number }) => s + l.amount,
      0,
    );

  it('earnings lines add up to the slip earnings total, with incentives and overtime separate', () => {
    expect(total('earnings')).toBe(computeEarningsTotal(earnings));
    const labels = byKey.earnings.lines.map((l: { label: string }) => l.label);
    expect(labels).toEqual([
      'Basic Stipend',
      'Extra Days (2)',
      'Overtime',
      'Incentives',
      'Reward On Progress',
      'Petrol',
      'Travelling Exp',
    ]);
  });

  it('deduction sections add up to the slip deductions total', () => {
    expect(total('attendance') + total('discipline') + total('other')).toBe(
      computeDeductionsTotal(deductions),
    );
  });

  it('early checkout is an attendance deduction, not a discipline fine', () => {
    expect(byKey.attendance.lines).toEqual([
      { label: 'Absence', amount: 800 },
      { label: 'Late', amount: 1000 },
      { label: 'Early checkout', amount: 1000 },
    ]);
  });

  it('discipline fines show each reason with its amount', () => {
    expect(byKey.discipline.lines).toEqual([
      { label: 'Fine: No uniform', amount: 300 },
      { label: 'Fine: Mobile on duty', amount: 200 },
      { label: 'Disciplinary action fine', amount: 400 },
    ]);
  });

  it('drops empty lines instead of printing Nil', () => {
    expect(byKey.other.lines).toEqual([
      { label: 'Advance', amount: 1000 },
      { label: 'Medicine Pending', amount: 500 },
    ]);
  });
});
