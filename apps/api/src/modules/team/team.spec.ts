import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TeamService } from './team.service';
import { onlyTeamIncharge, teamEmployeeWhere } from './team.util';

describe('Team In-charge', () => {
  it('team = active staff of the assigned department + designation pairs, all branches', async () => {
    const prisma = {
      teamAssignment: { findMany: jest.fn().mockResolvedValue([{ departmentId: 'd1', designation: 'STAFF NURSE' }]) },
    };
    const where = await teamEmployeeWhere(prisma, 'u1');
    expect(where.OR).toEqual([
      { currentDepartmentId: 'd1', currentDesignation: { equals: 'STAFF NURSE', mode: 'insensitive' } },
    ]);
    // No pairs: an empty OR, which matches nobody.
    prisma.teamAssignment.findMany.mockResolvedValue([]);
    expect((await teamEmployeeWhere(prisma, 'u1')).OR).toEqual([]);
  });

  it('only a pure Team In-charge login is narrowed', () => {
    expect(onlyTeamIncharge([UserRole.TEAM_INCHARGE])).toBe(true);
    expect(onlyTeamIncharge([UserRole.TEAM_INCHARGE, UserRole.HR_EXECUTIVE])).toBe(false);
  });

  it('a department + designation already given to another login cannot be assigned again', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: UserRole.TEAM_INCHARGE, additionalRoles: [] }) },
      teamAssignment: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 'other', departmentId: 'd1', designation: 'STAFF NURSE', user: { email: 'a@ycdo.org' }, department: { name: 'Nursing' } },
        ]),
        createMany: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new TeamService(prisma as never);
    await expect(
      service.assign('it', 'u1', [{ departmentId: 'd1', designation: ' staff  nurse ' }]),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.teamAssignment.createMany).not.toHaveBeenCalled();
  });

  it("progress can be saved only for the in-charge's own team", async () => {
    const prisma = {
      teamAssignment: { findMany: jest.fn().mockResolvedValue([{ departmentId: 'd1', designation: 'STAFF NURSE' }]) },
      employee: { count: jest.fn().mockResolvedValue(0) },
      teamProgress: { upsert: jest.fn() },
    };
    const service = new TeamService(prisma as never);
    await expect(
      service.saveProgress('u1', { employeeId: 'e9', month: 10, year: 2026, rating: 4 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    prisma.employee.count.mockResolvedValue(1);
    await service.saveProgress('u1', { employeeId: 'e1', month: 10, year: 2026, rating: 4, remarks: ' good ' });
    expect(prisma.teamProgress.upsert.mock.calls[0][0].create).toMatchObject({ rating: 4, remarks: 'good', employeeId: 'e1' });
  });
});
