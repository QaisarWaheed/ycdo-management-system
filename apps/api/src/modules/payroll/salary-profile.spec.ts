import { EmployeeFinancialService } from './employee-financial.service';

describe('one-page salary profile', () => {
  it('brings package, last month incentives, discipline, loans and recent salaries together', async () => {
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 'e1', fullName: 'Test', employeeCode: 'YCDO-1' }) },
      stipendRecord: {
        findFirst: jest.fn().mockResolvedValue({
          basicStipend: 50000,
          lumpsumTotal: 55000,
          effectiveFrom: new Date('2026-09-01T00:00:00Z'),
        }),
      },
      employeeAllowance: {
        findMany: jest.fn().mockResolvedValue([{ amount: 5000, type: { name: 'Incharge' } }]),
      },
      incentive: {
        findMany: jest.fn().mockResolvedValue([
          { amount: 2000, reason: 'Good month', type: { name: 'On Progress' } },
          { amount: 1000, reason: 'Room', type: null },
        ]),
      },
      letter: {
        groupBy: jest.fn().mockResolvedValue([{ letterType: 'WARNING', _count: { _all: 2 } }]),
      },
      doctorMonthlyPerformance: { findMany: jest.fn().mockResolvedValue([]) },
      employeeLoan: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'l1', kind: 'LOAN', amount: 10000, monthlyInstallment: 5000 },
        ]),
      },
      payrollDeduction: {
        findMany: jest.fn().mockResolvedValue([{ description: 'Loan installment [l1]', amount: 5000 }]),
      },
    };
    const service = new EmployeeFinancialService(prisma as never);
    jest.spyOn(service, 'summary').mockResolvedValue({
      months: [{ month: 9 }, { month: 8 }, { month: 7 }, { month: 6 }],
    } as never);

    const p = await service.salaryProfile('e1');
    expect(p.package).toMatchObject({ basicStipend: 50000, allowances: [{ name: 'Incharge', amount: 5000 }] });
    expect(p.previousMonthIncentives.total).toBe(3000);
    expect(p.discipline).toEqual({ WARNING: 2 });
    expect(p.loans[0]).toMatchObject({ remaining: 5000 });
    expect(p.lastMonths).toHaveLength(3);
    // The attendance card needs tables this double lacks: the page still loads.
    expect(p.attendance).toBeNull();
  });
});
