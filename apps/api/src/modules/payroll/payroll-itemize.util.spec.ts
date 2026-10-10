import { itemizePayrollEntries } from './payroll-itemize.util';

const employee = {
  id: 'e1',
  fullName: 'Ali',
  employeeCode: 'Y-1',
  currentDesignation: 'Nurse',
  currentBranch: { name: 'Head Office' },
  currentDepartment: { name: 'Nursing' },
};

describe('itemizePayrollEntries', () => {
  it('splits a month into lines that add up to the entry totals', () => {
    const [row] = itemizePayrollEntries(
      [
        {
          employee,
          basicStipend: 20000,
          // package 7000 (Pharmacy 2000 + Travelling Exp 5000) + OT 800 + incentive 1500 + manual 500
          totalAllowances: 9800,
          // late 667 + fine 300 + early checkout 1000 + package loan 2000
          totalDeductions: 3967,
          netStipend: 25833,
          packageAllowanceLines: [
            { label: 'Pharmacy', amount: 2000 },
            { label: 'Travelling Exp', amount: 5000 },
          ],
          allowances: [
            { type: 'OVERTIME', amount: 800 },
            { type: 'CUSTOM', amount: 1500, description: 'Incentive: On Progress' },
            { type: 'CUSTOM', amount: 500, description: 'Eid bonus' },
          ],
          deductions: [
            { reason: 'LATE_ARRIVAL', amount: 667 },
            { reason: 'FINE', amount: 300, fineReason: 'NO_UNIFORM' },
            {
              reason: 'DISCIPLINARY_FINE',
              amount: 1000,
              description: 'Attendance Card: every 3 Early Checkout',
            },
          ],
        },
      ],
      [{ employeeId: 'e1', amount: 1500, type: { name: 'On Progress' } }],
    );
    expect(row.allowances).toEqual({ Overtime: 800, Pharmacy: 2000, 'Travelling Exp': 5000 });
    expect(row.incentives).toEqual({ 'Manual addition': 500, 'On Progress': 1500 });
    expect(row.deductions).toEqual({
      Late: 667,
      'Fine: No uniform': 300,
      'Early checkout': 1000,
      'Fixed package deductions': 2000,
    });
    const sum = (o: Record<string, number>) => Object.values(o).reduce((s, n) => s + n, 0);
    expect(sum(row.allowances) + sum(row.incentives)).toBe(9800);
    expect(sum(row.deductions)).toBe(3967);
  });

  it('shows the package as one line before the allowance table and merges stipend segments', () => {
    const base = {
      employee,
      netStipend: 0,
      totalDeductions: 0,
      allowances: [],
      deductions: [],
    };
    const [row] = itemizePayrollEntries(
      [
        { ...base, basicStipend: 10000, totalAllowances: 3000 },
        { ...base, basicStipend: 6000, totalAllowances: 0 },
      ],
      [],
    );
    expect(row.basic).toBe(16000);
    expect(row.allowances).toEqual({ 'Package allowances': 3000 });
  });

  it('leaves out employees with nothing paid or deducted', () => {
    expect(
      itemizePayrollEntries(
        [
          {
            employee,
            basicStipend: 0,
            netStipend: 0,
            totalAllowances: 0,
            totalDeductions: 0,
            allowances: [],
            deductions: [],
          },
        ],
        [],
      ),
    ).toEqual([]);
  });
});
