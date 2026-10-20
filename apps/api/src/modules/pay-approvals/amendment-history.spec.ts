import {
  describeAmendment,
  PayChangeRequestsService,
} from './pay-change-requests.service';

describe('salary amendment history', () => {
  it('describes package, allowance, request and loan changes in words', () => {
    expect(
      describeAmendment('SALARY_INCREMENT', {
        previousSalary: 30000,
        newBasicStipend: 35000,
        lumpsumTotal: 40000,
      }),
    ).toEqual({
      type: 'Salary increment',
      detail: 'Basic PKR 30,000 → PKR 35,000, package PKR 40,000',
    });
    expect(
      describeAmendment('EMPLOYEE_ALLOWANCE_SET', {
        type: 'Incharge',
        before: 0,
        after: 3000,
        startMonth: '2026-11',
      }).detail,
    ).toBe('Incharge PKR 0 → PKR 3,000 from 2026-11');
    expect(
      describeAmendment('PAY_CHANGE_APPROVED', {
        summary: 'Basic 25,000 → 30,000',
        reviewNote: 'ok',
      }),
    ).toEqual({
      type: 'Pay request approved',
      detail: 'Basic 25,000 → 30,000 · Note: ok',
    });
    expect(describeAmendment('LOAN_APPROVED', { note: null }).type).toBe(
      'Loan approved',
    );
  });

  it('collects the employee history newest first with who made each change', async () => {
    const prisma = {
      stipendRecord: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }]) },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'a1',
            action: 'PAY_PACKAGE_VERIFIED',
            createdAt: new Date('2026-10-20T08:00:00Z'),
            changes: {},
            user: { email: 'finance@ycdo.org', employee: null },
          },
        ]),
      },
    };
    const service = new PayChangeRequestsService(prisma as never);
    const rows = await service.packageHistory('e1');
    expect(rows[0]).toMatchObject({
      type: 'Verified by Finance',
      by: 'finance@ycdo.org',
    });
    const where = prisma.auditLog.findMany.mock.calls[0][0].where.OR;
    expect(where[0].entityId).toEqual({ in: ['s1'] });
  });
});
