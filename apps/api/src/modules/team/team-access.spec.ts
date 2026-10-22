import { ForbiddenException } from '@nestjs/common';
import { PaySuggestionKind, Permission, UserRole } from '@prisma/client';
import { AccessScopeService } from '../permissions/access-scope.service';
import { IncentiveManagementService } from '../incentive-management/incentive-management.service';
import { LettersService } from '../letters/letters.service';

const teamPrisma = (inTeam: number) => ({
  user: {
    findUnique: jest
      .fn()
      .mockResolvedValue({
        role: UserRole.TEAM_INCHARGE,
        additionalRoles: [],
        managerScopes: [],
      }),
  },
  userPermission: { findUnique: jest.fn().mockResolvedValue(null) },
  teamAssignment: {
    findMany: jest
      .fn()
      .mockResolvedValue([{ departmentId: 'd1', designation: 'STAFF NURSE' }]),
  },
  employee: { count: jest.fn().mockResolvedValue(inTeam) },
});

describe('Team In-charge sees and letters only its team', () => {
  it('employee and letter lists are narrowed to the team', async () => {
    const scope = new AccessScopeService(teamPrisma(1) as never);
    const where = await scope.narrowEmployeeWhereForActor(
      'u1',
      UserRole.TEAM_INCHARGE,
      { isDeleted: false } as never,
    );
    expect(JSON.stringify(where)).toContain('STAFF NURSE');
  });

  it('opening or lettering someone outside the team is refused', async () => {
    const scope = new AccessScopeService(teamPrisma(0) as never);
    await expect(
      scope.assertEmployeeAccess(
        'u1',
        UserRole.TEAM_INCHARGE,
        Permission.LETTERS_GENERATE,
        'e9',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const ok = new AccessScopeService(teamPrisma(1) as never);
    await expect(
      ok.assertEmployeeAccess(
        'u1',
        UserRole.TEAM_INCHARGE,
        Permission.LETTERS_GENERATE,
        'e1',
      ),
    ).resolves.toBeUndefined();
  });

  it('a Team In-charge cannot send a letter; HR does', async () => {
    const letters = Object.create(LettersService.prototype) as LettersService;
    jest
      .spyOn(letters, 'findOne')
      .mockResolvedValue({ id: 'l1', employeeId: 'e1' } as never);
    await expect(
      letters.sendLetter('l1', 'u1', UserRole.TEAM_INCHARGE),
    ).rejects.toThrow('HR sends them');
  });
});

describe('Finance decides deduction suggestions only', () => {
  const finance = {
    id: 'f1',
    role: UserRole.PAYROLL_OFFICER,
    roles: [UserRole.PAYROLL_OFFICER],
  };
  const item = (kind: PaySuggestionKind) => ({
    employeeId: 'e1',
    kind,
    typeId: 't1',
    amount: 500,
  });

  it('Finance cannot approve an incentive suggestion', async () => {
    const service = new IncentiveManagementService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.apply(finance, {
        month: 10,
        year: 2026,
        items: [item(PaySuggestionKind.INCENTIVE)],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('Finance cannot reject a non-deduction suggestion', async () => {
    const prisma = {
      incentiveSuggestion: {
        count: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn(),
      },
    };
    const service = new IncentiveManagementService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.reject(finance, { suggestionIds: ['s1'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.incentiveSuggestion.updateMany).not.toHaveBeenCalled();
  });
});
