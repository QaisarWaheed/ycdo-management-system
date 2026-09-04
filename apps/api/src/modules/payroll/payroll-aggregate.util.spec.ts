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
