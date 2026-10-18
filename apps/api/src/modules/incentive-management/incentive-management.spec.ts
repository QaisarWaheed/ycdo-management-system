import { ForbiddenException } from '@nestjs/common';
import { PaySuggestionKind, PaySuggestionStatus, UserRole } from '@prisma/client';
import { IncentiveManagementService } from './incentive-management.service';

const CHAIR = { id: 'c', role: UserRole.CHAIRMAN, roles: [UserRole.CHAIRMAN] };
const HEAD = { id: 'h', role: UserRole.DEPARTMENT_HEAD, roles: [UserRole.DEPARTMENT_HEAD] };

function setup() {
  const prisma = {
    incentive: { findMany: jest.fn().mockResolvedValue([{ id: 'i1', amount: 3000 }]) },
    employeeAllowance: { findMany: jest.fn().mockResolvedValue([]) },
    incentiveSuggestion: {
      findUnique: jest.fn().mockResolvedValue({ id: 's1', suggestedAmount: 5000 }),
      update: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 's2' }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ employee: { currentDepartmentId: 'd1' } }) },
    employee: { count: jest.fn().mockResolvedValue(0) },
    auditLog: { create: jest.fn() },
  };
  const incentives = { create: jest.fn(), update: jest.fn(), delete: jest.fn() };
  const allowances = { assign: jest.fn(), end: jest.fn() };
  const service = new IncentiveManagementService(prisma as never, incentives as never, allowances as never);
  return { service, prisma, incentives, allowances };
}

describe('Req 7/8 incentive management', () => {
  it('executive amount different from the suggestion updates the incentive and marks it AMENDED', async () => {
    const { service, prisma, incentives } = setup();
    const r = await service.apply(CHAIR, {
      month: 10,
      year: 2026,
      items: [{ employeeId: 'e1', kind: PaySuggestionKind.INCENTIVE, typeId: 't1', amount: 4000 }],
    });
    expect(r).toEqual({ applied: 1, failed: [] });
    expect(incentives.update).toHaveBeenCalledWith('i1', expect.objectContaining({ amount: 4000 }), 'c');
    expect(prisma.incentiveSuggestion.update.mock.calls[0][0].data.status).toBe(PaySuggestionStatus.AMENDED);
  });

  it('department head cannot suggest outside their department, nor approve', async () => {
    const { service } = setup();
    await expect(
      service.suggest(HEAD, {
        employeeId: 'other',
        kind: PaySuggestionKind.INCENTIVE,
        typeId: 't1',
        month: 10,
        year: 2026,
        amount: 1000,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.apply(HEAD, { month: 10, year: 2026, items: [] })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
