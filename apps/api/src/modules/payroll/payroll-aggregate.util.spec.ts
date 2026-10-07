import { PayrollStatus } from '@prisma/client';
import {
  aggregateMonthlyPayrollByEmployee,
  aggregatePayrollHistoryByMonth,
  toUtcMonthStart,
} from './payroll-aggregate.util';

describe('toUtcMonthStart', () => {
  it('snaps mid-month increment dates to the 1st', () => {
    expect(toUtcMonthStart(new Date('2026-08-28')).toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
    expect(toUtcMonthStart(new Date('2026-08-01')).toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });
});

describe('aggregateMonthlyPayrollByEmployee', () => {
  it('sums Zakir-style mid-month segments into one monthly row', () => {
    const employee = { id: 'emp-zakir', fullName: 'Zakir Ali' };
    const rows = aggregateMonthlyPayrollByEmployee([
      {
        id: 'pe-early',
        month: 8,
        year: 2026,
        basicStipend: 26322.58,
        totalAllowances: 1086.76,
        totalDeductions: 1086.76,
        netStipend: 26322.58,
        status: PayrollStatus.PENDING,
        forcedNonActive: true,
        stipendRecord: {
          employeeId: 'emp-zakir',
          employee,
          effectiveFrom: new Date('2021-02-21T00:00:00.000Z'),
          effectiveTo: new Date('2026-08-25T00:00:00.000Z'),
        },
        attendance: { present: 17, absent: 0 },
      },
      {
        id: 'pe-late',
        month: 8,
        year: 2026,
        basicStipend: 7903.23,
        totalAllowances: 0,
        totalDeductions: 0,
        netStipend: 7903.23,
        status: PayrollStatus.PENDING,
        stipendRecord: {
          employeeId: 'emp-zakir',
          employee,
          effectiveFrom: new Date('2026-08-25T00:00:00.000Z'),
          effectiveTo: null,
        },
        attendance: { present: 17, absent: 0 },
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('pe-late');
    expect(Number(rows[0]!.basicStipend)).toBe(34225.81);
    expect(Number(rows[0]!.netStipend)).toBe(34225.81);
    expect(rows[0]!.forcedNonActive).toBe(true);
    expect(rows[0]!.attendance).toEqual({ present: 17, absent: 0 });
  });

  it('day-1 increment: the old package entry adds only HR/Finance manual items', () => {
    const employee = { id: 'emp-1', fullName: 'Sample' };
    const rows = aggregateMonthlyPayrollByEmployee([
      {
        // Leftover on the old 20,000 package; its effectiveTo is the 1st, so it
        // no longer covers September.
        id: 'pe-old',
        month: 9,
        year: 2026,
        basicStipend: 20000,
        totalAllowances: 1833.33,
        totalDeductions: 1500,
        netStipend: 20333.33,
        status: PayrollStatus.PENDING,
        stipendRecord: {
          employeeId: 'emp-1',
          employee,
          effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2026-09-01T00:00:00.000Z'),
        },
        allowances: [
          { type: 'ADDITIONAL_WORKING_DAYS', amount: 1333.33 },
          { type: 'CUSTOM', amount: 500, description: 'Incentive' },
        ],
        deductions: [
          { reason: 'LOAN', amount: 1000, description: 'Loan instalment' },
          { reason: 'UNINFORMED_ABSENCE', amount: 500, description: 'Attendance Card: additional absence penalty' },
        ],
      },
      {
        id: 'pe-new',
        month: 9,
        year: 2026,
        basicStipend: 25000,
        totalAllowances: 6666.67,
        totalDeductions: 0,
        netStipend: 31666.67,
        status: PayrollStatus.PENDING,
        stipendRecord: {
          employeeId: 'emp-1',
          employee,
          effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
          effectiveTo: null,
        },
        allowances: [{ type: 'ADDITIONAL_WORKING_DAYS', amount: 1666.67 }],
        deductions: [],
      },
    ]);

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe('pe-new');
    expect(Number(row.basicStipend)).toBe(25000); // not 45,000
    expect(Number(row.totalAllowances)).toBe(7166.67); // new entry + 500 incentive
    expect(Number(row.totalDeductions)).toBe(1000); // loan kept, card absence dropped
    expect(Number(row.netStipend)).toBe(31166.67); // 31,666.67 + 500 - 1,000
    expect(row.allowances).toHaveLength(2);
    expect(row.allowances).toEqual(
      expect.arrayContaining([
        { type: 'ADDITIONAL_WORKING_DAYS', amount: 1666.67 },
        { type: 'CUSTOM', amount: 500, description: 'Incentive' },
      ]),
    );
    expect(row.deductions).toEqual([
      { reason: 'LOAN', amount: 1000, description: 'Loan instalment' },
    ]);
  });

  it('keeps different employees as separate rows', () => {
    const rows = aggregateMonthlyPayrollByEmployee([
      {
        id: 'a',
        month: 8,
        year: 2026,
        basicStipend: 10000,
        totalAllowances: 0,
        totalDeductions: 0,
        netStipend: 10000,
        status: PayrollStatus.PENDING,
        stipendRecord: {
          employeeId: 'e1',
          employee: { id: 'e1', fullName: 'A' },
          effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
          effectiveTo: null,
        },
      },
      {
        id: 'b',
        month: 8,
        year: 2026,
        basicStipend: 20000,
        totalAllowances: 0,
        totalDeductions: 0,
        netStipend: 20000,
        status: PayrollStatus.PENDING,
        stipendRecord: {
          employeeId: 'e2',
          employee: { id: 'e2', fullName: 'B' },
          effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
          effectiveTo: null,
        },
      },
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe('aggregatePayrollHistoryByMonth', () => {
  it('still sums segments within a month for one employee', () => {
    const rows = aggregatePayrollHistoryByMonth([
      {
        id: '1',
        month: 8,
        year: 2026,
        basicStipend: 100,
        totalAllowances: 0,
        totalDeductions: 0,
        netStipend: 100,
        status: PayrollStatus.PENDING,
        stipendRecord: {
          effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2026-08-15T00:00:00.000Z'),
        },
      },
      {
        id: '2',
        month: 8,
        year: 2026,
        basicStipend: 200,
        totalAllowances: 0,
        totalDeductions: 0,
        netStipend: 200,
        status: PayrollStatus.PENDING,
        stipendRecord: {
          effectiveFrom: new Date('2026-08-15T00:00:00.000Z'),
          effectiveTo: null,
        },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.basicStipend)).toBe(300);
  });
});
