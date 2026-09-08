import { Prisma } from '@prisma/client';
import { PayrollService } from './payroll.service';
import { formatSlipMoney } from './payslip-slip.util';
jest.mock('../attendance/discipline.helper', () => ({}));
const cases = [
  { name: 'allowance only', basic: 30000, allowance: 5000, expected: 35000 },
  { name: 'reported August example', basic: 30000, allowance: 5000, fuel: 5000, ot: 0.58, otPay: 70.16, expected: 40070.16 },
  { name: 'fuel only', basic: 30000, fuel: 5000, expected: 35000 },
  { name: 'allowance and fuel', basic: 30000, allowance: 5000, fuel: 5000, expected: 40000 },
  { name: 'reward and progress reward', basic: 31000, reward: 1200, progress: 2300, expected: 34500 },
  { name: 'custom mobile addition', basic: 31000, custom: 700, expected: 31700 },
  { name: 'all additions with OT and AWD', basic: 31000, allowance: 1000, fuel: 2000, reward: 3000, progress: 4000, custom: 500, ot: 8, otPay: 1000, awd: 1, expected: 43500 },
  { name: 'valid deductions', basic: 31000, allowance: 1000, fuel: 2000, reward: 3000, progress: 4000, custom: 500, deduction: 100, expected: 40900 },
  { name: 'zero additions', basic: 31000, expected: 31000 },
];
describe('global stored package additions to generated Card salary and payslip', () => {
  it.each(cases.flatMap((c: any) => (c.custom || c.deduction ? [true] : [false, true]).map(existing => ({ ...c, existing }))))('$name (existing payroll: $existing)', async (input: any) => {
    const employeeId = `employee-${input.name}`;
    const employee = { id: employeeId, employeeCode: employeeId, fullName: input.name, status: 'ACTIVE', joiningDate: new Date('2020-01-01'), dutyTotalHours: 8, monthlyAllowedLeaves: 2 };
    const pkg = { id: `package-${input.name}`, employeeId, basicStipend: new Prisma.Decimal(input.basic), allowances: new Prisma.Decimal(input.allowance ?? 0), fuelAllowance: new Prisma.Decimal(input.fuel ?? 0), reward: new Prisma.Decimal(input.reward ?? 0), progressReward: new Prisma.Decimal(input.progress ?? 0), loanDeduction: input.deduction ?? 0, advanceDeduction: input.deduction ?? 0, fineDeduction: input.deduction ?? 0, healthDeduction: input.deduction ?? 0, effectiveFrom: new Date('2026-08-01'), effectiveTo: null };
    let entry: any = { id: `entry-${employeeId}`, stipendRecordId: pkg.id, status: 'PENDING', month: 8, year: 2026 };
    let allowances: any[] = input.custom ? [{ id: 'custom', type: 'CUSTOM', description: 'Mobile load', amount: input.custom }] : [];
    let deductions: any[] = input.deduction ? [{ id: 'manual', reason: 'OTHER', description: 'Valid manual deduction', amount: input.deduction }, { id: 'inquiry', reason: 'DISCIPLINARY_FINE', description: 'Inquiry fine', amount: input.deduction }] : [];
    if (!input.existing) entry = null;
    const view = () => entry && ({ ...entry, allowances, deductions, stipendRecord: { ...pkg, employee } });
    const db: any = {
      employee: { findUnique: jest.fn(async () => employee) },
      attendanceLog: { findMany: jest.fn(async () => Array.from({ length: 31 }, (_, i) => ({ date: new Date(Date.UTC(2026, 7, i + 1)), status: 'PRESENT', overtimeMinutes: i === 0 ? (input.ot ?? 0) * 60 : 0, overtimePending: true, overtimeApprovedAt: null, lateMinutes: 0 }))) },
      additionalWorkingDay: { findMany: jest.fn(async () => Array.from({ length: input.awd ?? 0 }, () => ({ date: new Date('2026-08-01') }))) },
      payrollEntry: {
        findUnique: jest.fn(async () => view()), create: jest.fn(async ({ data }) => { entry = { id: 'new-entry', ...data }; return view(); }), findFirst: jest.fn(async () => null), findMany: jest.fn(async () => [view()]),
        update: jest.fn(async ({ data }) => { entry = { ...entry, ...data }; return view(); }),
      },
      allowance: { deleteMany: jest.fn(async ({ where }) => { allowances = allowances.filter(a => !where.id.in.includes(a.id)); }), create: jest.fn(async ({ data }) => { const row = { id: `extra-${allowances.length}`, ...data }; allowances.push(row); return row; }) },
      payrollDeduction: { deleteMany: jest.fn(async ({ where }) => { deductions = deductions.filter(d => !where.id.in.includes(d.id)); }), create: jest.fn(async ({ data }) => { const row = { id: `deduction-${deductions.length}`, ...data }; deductions.push(row); return row; }) },
    };
    const service: any = new PayrollService(db, {} as any);
    const generate = () => service.upsertPayrollEntryForStipendSegment(pkg, { employeeId, month: 8, year: 2026 }, employee, undefined, [], true);
    for (let i = 0; i < 2; i++) {
      const generated = await generate();
      expect(generated.basicStipend).toBe(input.basic);
      expect(generated.netStipend).toBe(input.expected);
      expect(generated.totalAllowances).toBeCloseTo(input.expected - input.basic + (input.deduction ?? 0) * 6, 8);
      expect(generated.totalDeductions).toBe((input.deduction ?? 0) * 6);
    }
    entry.status = 'PROCESSED';
    const { slip } = await service.getEntryWithAllowances(entry.id);
    expect(slip.earnings.fuel).toBe(input.fuel ?? 0);
    expect(slip.earnings.rewards).toBe(input.reward ?? 0);
    expect(slip.earnings.rewardOnProgress).toBe(input.progress ?? 0);
    expect(slip.earnings.otherAllowance).toBe((input.allowance ?? 0) + (input.custom ?? 0) + (input.otPay ?? 0));
    expect(slip.earnings.extraDuty).toBe(input.awd ? 1000 : 0);
    expect(slip.earnings.mobileLoad).toBe(0);
    expect(slip.earnings.previousMonth).toBe(0);
    expect(slip.earningsTotal - slip.deductionsTotal).toBe(input.expected);
    expect(slip.netPay).toBe(input.expected);
    if (input.name === 'zero additions') for (const [key, amount] of Object.entries(slip.earnings)) if (key !== 'stipend') expect(formatSlipMoney(amount as number)).toBe('Nil');
  });
  it('renders 30,000 + 5,000 + 5,000 + 70.16 as 40,070.16', () => {
    const service: any = new PayrollService({} as any, {} as any);
    const slip = service.buildPayslipSlipData({ entry: { month: 8, year: 2026, basicStipend: 30000, netStipend: 40070.16, allowances: [{ type: 'OVERTIME', amount: 70.16 }] }, stipendRecord: { basicStipend: 30000, allowances: 5000, fuelAllowance: 5000 }, employee: { fullName: 'Example', employeeCode: 'EX', dutyTotalHours: 8 }, presenceDays: 31, leaveSplit: { leaveDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0 } });
    expect(slip.earnings.fuel).toBe(5000);
    expect(slip.earnings.otherAllowance).toBe(5070.16);
    expect(slip.earningsTotal).toBe(40070.16);
    expect(slip.netPay).toBe(40070.16);
  });
});



