import { EmployeeFinancialService } from './employee-financial.service';

describe('Req 1 employee financial summary', () => {
  it('splits a month into allowances, incentives, overtime, fines and deductions, with the change trail', async () => {
    const prisma = {
      payrollEntry: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'p1',
            month: 10,
            year: 2026,
            status: 'PENDING',
            basicStipend: 30000,
            netStipend: 33000,
            totalAllowances: 6000,
            allowances: [
              { type: 'OVERTIME', amount: 1000, description: 'OT' },
              { type: 'CUSTOM', amount: 2000, description: 'Incentive: On Progress' },
              { type: 'CUSTOM', amount: 500, description: 'Salary difference' },
            ],
            deductions: [
              { id: 'd1', reason: 'DISCIPLINARY_FINE', amount: 1000, fineReason: 'NO_UNIFORM', description: null },
              { id: 'd2', reason: 'LATE_ARRIVAL', amount: 2000, fineReason: null, description: '3 late' },
            ],
          },
        ]),
      },
      incentive: { findMany: jest.fn().mockResolvedValue([]) },
      employeeAllowance: { findMany: jest.fn().mockResolvedValue([]) },
      stipendRecord: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }]) },
      letter: { findMany: jest.fn().mockResolvedValue([{ generatedAt: new Date('2026-10-10T08:00:00Z') }]) },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            createdAt: new Date('2026-10-02'),
            user: { email: 'hr@x' },
            entity: 'StipendRecord',
            entityId: 's1',
            action: 'SALARY_INCREMENT',
            changes: { previousSalary: 28000, newBasicStipend: 30000, reason: 'Annual' },
          },
        ]),
      },
      payrollChangeLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const r = await new EmployeeFinancialService(prisma as never).summary('e1');
    expect(r.months[0]).toMatchObject({
      overtime: 1000,
      incentives: 2000,
      allowances: 500 + 2500, // custom row + package allowances not stored as rows
      fines: 1000,
      otherDeductions: 2000,
      letters: 1,
    });
    expect(r.totals.fines).toBe(1000);
    expect(r.history[0]).toMatchObject({ area: 'Salary', before: 28000, after: 30000, reason: 'Annual', by: 'hr@x' });
  });
});
