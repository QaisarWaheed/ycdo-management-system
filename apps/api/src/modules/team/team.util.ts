import { EmployeeStatus, Prisma, UserRole } from '@prisma/client';

type TeamPrisma = {
  teamAssignment: {
    findMany(args: {
      where: { userId: string };
      select: { departmentId: true; designation: true };
    }): Promise<Array<{ departmentId: string; designation: string }>>;
  };
};

/** Designation titles are compared trimmed and upper case (Employee.currentDesignation is free text). */
export const normDesignation = (title: string) => title.trim().replace(/\s+/g, ' ').toUpperCase();

/** A login whose only job is the team: its employee lists are narrowed to the team. */
export const onlyTeamIncharge = (roles: UserRole[]) =>
  roles.includes(UserRole.TEAM_INCHARGE) &&
  roles.every((r) => r === UserRole.TEAM_INCHARGE || r === UserRole.EMPLOYEE);

/**
 * Employees a Team In-charge looks after: active staff of every department +
 * designation pair IT gave the login, in all branches. No pairs: nobody.
 */
export async function teamEmployeeWhere(prisma: TeamPrisma, userId: string): Promise<Prisma.EmployeeWhereInput> {
  const pairs = await prisma.teamAssignment.findMany({
    where: { userId },
    select: { departmentId: true, designation: true },
  });
  return {
    status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] },
    OR: pairs.map((p) => ({
      currentDepartmentId: p.departmentId,
      currentDesignation: { equals: p.designation, mode: 'insensitive' as const },
    })),
  };
}
