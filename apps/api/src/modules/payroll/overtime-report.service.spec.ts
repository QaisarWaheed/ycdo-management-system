import { PayrollStatus } from '@prisma/client';
import {
  lastSixMonths,
  overtimeDeductionCategory,
  OvertimeReportService,
} from './overtime-report.service';

const emp = (id: string, branch: string, dept: string) => ({
  id,
  fullName: `Emp ${id}`,
  employeeCode: id.toUpperCase(),
  currentBranchId: `b-${branch}`,
  currentDepartmentId: `d-${dept}`,
  currentBranch: { name: branch },
  currentDepartment: { name: dept },
});

const entry = (
  id: string,
  employee: ReturnType<typeof emp>,
  opts: {
    month?: number;
    effectiveFrom?: Date;
    effectiveTo?: Date | null;
    allowances?: Array<{ type: string; amount: number; hours?: number | null }>;
    deductions?: Array<{
      reason: string;
      amount: number;
      description?: string;
    }>;
  } = {},
) => ({
  id,
  month: opts.month ?? 8,
  year: 2026,
  basicStipend: 30000,
  totalAllowances: 0,
  totalDeductions: 0,
  netStipend: 0,
  status: PayrollStatus.PENDING,
  allowances: opts.allowances ?? [],
  deductions: opts.deductions ?? [],
  stipendRecord: {
    employeeId: employee.id,
    effectiveFrom: opts.effectiveFrom ?? new Date(Date.UTC(2026, 0, 1)),
    effectiveTo: opts.effectiveTo ?? null,
    employee,
  },
});

function build(current: unknown[], trend: unknown[] = [], awd: unknown[] = []) {
  const findMany = jest
    .fn()
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce(trend);
  const prisma = {
    payrollEntry: { findMany },
    additionalWorkingDay: { findMany: jest.fn().mockResolvedValue(awd) },
  };
  const scope = {
    narrowEmployeeWhereForActor: jest.fn(async (_u, _r, where) => ({
      ...where,
      currentBranchId: 'b-Lahore',
    })),
  };
  return {
    service: new OvertimeReportService(prisma as never, scope as never),
    prisma,
    scope,
  };
}

describe('OvertimeReportService', () => {
  const a = emp('a', 'Lahore', 'Nursing');
  const b = emp('b', 'Lahore', 'Admin');
  const c = emp('c', 'Karachi', 'Nursing');

  it('sums mid-month segments, applies net math and branch/department totals', async () => {
    const { service } = build(
      [
        // Employee A: increment on the 16th -> two covering segments in August.
        entry('a1', a, {
          effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
          effectiveTo: new Date(Date.UTC(2026, 7, 16)),
          allowances: [{ type: 'OVERTIME', amount: 1000, hours: 4 }],
          deductions: [{ reason: 'LATE_ARRIVAL', amount: 200 }],
        }),
        entry('a2', a, {
          effectiveFrom: new Date(Date.UTC(2026, 7, 16)),
          allowances: [
            { type: 'OVERTIME', amount: 1500, hours: 5 },
            { type: 'ADDITIONAL_WORKING_DAYS', amount: 2000, hours: 8 },
            { type: 'CUSTOM', amount: 999 },
          ],
          deductions: [
            { reason: 'FINE', amount: 100 },
            { reason: 'LOAN', amount: 50 },
            {
              reason: 'DISCIPLINARY_FINE',
              amount: 30,
              description: 'Attendance Card: every 3 Early Checkout (3)',
            },
          ],
        }),
        entry('b1', b, {
          allowances: [{ type: 'RELIEVER', amount: 700 }],
          deductions: [{ reason: 'UNINFORMED_ABSENCE', amount: 1000 }],
        }),
        entry('c1', c, {
          allowances: [{ type: 'OVERTIME', amount: 400, hours: 2 }],
        }),
        // Req 6: deductions only -> listed too, so the deduction total is complete.
        entry('d1', emp('d', 'Karachi', 'Admin'), {
          deductions: [{ reason: 'FINE', amount: 500 }],
        }),
      ],
      [],
      [{ employeeId: 'a' }, { employeeId: 'a' }, { employeeId: 'b' }],
    );

    const r = await service.report({ month: 8, year: 2026 });

    const rowA = r.rows.find((x) => x.employeeId === 'a')!;
    expect(rowA).toMatchObject({
      otHours: 9,
      otAmount: 2500,
      extraDutyDays: 2,
      extraDutyAmount: 2000,
      attendanceDeductions: 230,
      fines: 100,
      otherDeductions: 50,
      totalDeductions: 380,
      net: 4120,
    });
    expect(r.rows.find((x) => x.employeeId === 'b')).toMatchObject({
      extraDutyDays: 1,
      extraDutyAmount: 700,
      net: -300,
    });
    expect(r.rows.map((x) => x.employeeId).sort()).toEqual(['a', 'b', 'c', 'd']);

    const lahore = r.byBranch.find((g) => g.name === 'Lahore')!;
    expect(lahore).toMatchObject({
      id: 'b-Lahore',
      employees: 2,
      otAmount: 2500,
      net: 3820,
    });
    const nursing = r.byDepartment.find((g) => g.name === 'Nursing')!;
    expect(nursing).toMatchObject({
      employees: 2,
      otAmount: 2900,
      otHours: 11,
    });
    expect(r.totals).toMatchObject({
      employees: 4,
      otAmount: 2900,
      extraDutyAmount: 2700,
      totalDeductions: 1880,
      net: 3720,
    });
    // Group totals add up to the grand total.
    const sumNet = (gs: Array<{ net: number }>) =>
      gs.reduce((s, g) => s + g.net, 0);
    expect(sumNet(r.byBranch)).toBe(r.totals.net);
    expect(sumNet(r.byDepartment)).toBe(r.totals.net);
    // Last trend point is the report's own OT total.
    expect(r.trend).toHaveLength(6);
    expect(r.trend[5]).toEqual({
      month: 8,
      year: 2026,
      otAmount: 2900,
      extraDutyAmount: 2700,
      totalDeductions: 1880,
    });
  });

  it('builds the 6-month trend from earlier months and narrows by actor scope', async () => {
    const { service, prisma, scope } = build(
      [],
      [
        entry('m3', a, {
          month: 3,
          allowances: [{ type: 'OVERTIME', amount: 300 }],
        }),
        entry('m7a', a, {
          month: 7,
          allowances: [{ type: 'OVERTIME', amount: 100 }],
        }),
        entry('m7b', b, {
          month: 7,
          allowances: [{ type: 'OVERTIME', amount: 50 }],
        }),
      ],
    );
    const r = await service.report(
      { month: 8, year: 2026, departmentId: 'd-Nursing' },
      { id: 'u1', role: 'HR_EXECUTIVE' as never },
    );
    expect(scope.narrowEmployeeWhereForActor).toHaveBeenCalled();
    expect(
      prisma.payrollEntry.findMany.mock.calls[0][0].where.stipendRecord
        .employee,
    ).toEqual({
      currentDepartmentId: 'd-Nursing',
      currentBranchId: 'b-Lahore',
    });
    expect(r.trend.map((t) => t.otAmount)).toEqual([300, 0, 0, 0, 150, 0]);
  });

  it('lastSixMonths crosses the year boundary', () => {
    expect(lastSixMonths(2, 2026)[0]).toEqual({ month: 9, year: 2025 });
  });

  it('categorises deductions like the payslip', () => {
    expect(overtimeDeductionCategory({ reason: 'HALF_DAY' })).toBe(
      'attendance',
    );
    expect(overtimeDeductionCategory({ reason: 'DISCIPLINARY_FINE' })).toBe(
      'fine',
    );
    expect(
      overtimeDeductionCategory({
        reason: 'OTHER',
        description: 'Unmarked day 3 Aug',
      }),
    ).toBe('attendance');
    expect(overtimeDeductionCategory({ reason: 'ADVANCE' })).toBe('other');
  });
});
