import {
  buildPayslipSections,
  computeDeductionsTotal,
  computeEarningsTotal,
  type PayslipSlipData,
} from './payslip-slip.util';

// Contract Basic 31,000; 2 days not paid (2,000) so earned 29,000 + unpaid 2,000.
const earnings: PayslipSlipData['earnings'] = {
  stipend: 31000,
  contractualStipend: 31000,
  previousMonth: 0,
  rewardOnProgress: 1000,
  rewards: 0,
  // package allowance 2000 + overtime 500 + incentive 1500 + manual addition 700
  otherAllowance: 4700,
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
  health: 100,
  providentFund: 0,
  tax: 0,
  auditDifference: 0,
  staffPendingMed: 500,
  kitchenPending: 0,
  electricityBill: 0,
  mobileBill: 0,
  other: 0,
  unpaidBasic: 2000,
};
const deductionRows = [
  {
    reason: 'UNINFORMED_ABSENCE',
    amount: 800,
    description: 'Attendance Card: additional absence penalty',
  },
  { reason: 'LATE_ARRIVAL', amount: 1000, description: 'Attendance Card: every 3 Late' },
  { reason: 'FINE', amount: 300, fineReason: 'NO_UNIFORM', description: 'No uniform on 5 Oct' },
  { reason: 'FINE', amount: 200, fineReason: 'MOBILE_ON_DUTY', description: 'Mobile in ward' },
  { reason: 'DISCIPLINARY_FINE', amount: 400, description: 'Inquiry fine — case 12' },
  {
    reason: 'DISCIPLINARY_FINE',
    amount: 1000,
    description: 'Attendance Card: every 3 Early Checkout',
  },
  { reason: 'MEDICINE_PENDING', amount: 500, description: 'Pending medicine bill' },
];
const allowanceRows = [
  { type: 'OVERTIME', amount: 500, hours: 4 },
  { type: 'CUSTOM', amount: 1500, description: 'Incentive: On Progress: ward shifting' },
  { type: 'CUSTOM', amount: 700, description: 'Extra duty in place of Dr. Atika' },
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
    unpaidDays: 2,
    counts: { late: 6, earlyCheckout: 3, uninformedAbsent: 1 },
  });
  const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));
  const total = (key: string) =>
    byKey[key].lines.reduce((s: number, l: { amount: number }) => s + l.amount, 0);

  it('shows the full contract Basic and explains every addition', () => {
    expect(total('earnings')).toBe(computeEarningsTotal(earnings));
    expect(byKey.earnings.lines).toEqual([
      { label: 'Basic Stipend', amount: 31000 },
      { label: 'Extra Days', amount: 2000, note: '2 days' },
      { label: 'Overtime', amount: 500, note: '4 hours' },
      { label: 'Incentive', amount: 1500, note: 'On Progress: ward shifting' },
      { label: 'Addition', amount: 700, note: 'Extra duty in place of Dr. Atika' },
      { label: 'Reward On Progress', amount: 1000 },
      { label: 'Petrol', amount: 3000 },
      { label: 'Travelling Exp', amount: 2000 },
    ]);
  });

  it('deduction sections add up to the slip deductions total', () => {
    expect(total('attendance') + total('discipline') + total('other')).toBe(
      computeDeductionsTotal(deductions),
    );
  });

  it('days not paid and attendance cuts carry their counts', () => {
    expect(byKey.attendance.lines).toEqual([
      { label: 'Absence', amount: 2000, note: '2 days not paid' },
      { label: 'Absence fine', amount: 800, note: '1 uninformed absence' },
      { label: 'Late', amount: 1000, note: '6 lates (every 3 = 1 day)' },
      { label: 'Early checkout', amount: 1000, note: '3 early checkouts (every 3 = 1 day)' },
    ]);
  });

  it('discipline fines show each reason with what Finance wrote', () => {
    expect(byKey.discipline.lines).toEqual([
      { label: 'Fine: No uniform', amount: 300, note: 'No uniform on 5 Oct' },
      { label: 'Fine: Mobile on duty', amount: 200, note: 'Mobile in ward' },
      { label: 'Disciplinary action fine', amount: 400, note: 'Inquiry fine — case 12' },
    ]);
  });

  it('lists each other deduction with its note and the package parts, no Nil lines', () => {
    expect(byKey.other.lines).toEqual([
      { label: 'Medicine pending', amount: 500, note: 'Pending medicine bill' },
      { label: 'Advance', amount: 1000, note: 'monthly package' },
      { label: 'Health', amount: 100, note: 'monthly package' },
    ]);
  });
});
