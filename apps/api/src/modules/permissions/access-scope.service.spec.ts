import { ProjectType, UserRole } from '@prisma/client';
import { AccessScopeService } from './access-scope.service';

describe('AccessScopeService helpers', () => {
  const service = new AccessScopeService({} as never);

  it('rejects executive roles as additional roles', () => {
    expect(() =>
      service.assertNoExecutiveAdditionalRoles([
        UserRole.HR_MANAGER,
        UserRole.PRESIDENT,
      ]),
    ).toThrow(/Executive roles cannot be assigned/);

    expect(
      service.rejectExecutiveAdditionalRoles([
        UserRole.FOUNDER,
        UserRole.ADMIN_OFFICER,
        UserRole.CHAIRMAN,
      ]),
    ).toEqual([UserRole.ADMIN_OFFICER]);
  });

  it('matches department-wide and designation-specific scopes', () => {
    const scopes = [
      {
        id: '1',
        projectId: 'proj-h',
        projectName: 'Central',
        departmentId: 'dept-opd',
        departmentName: 'OPD',
        designationId: null,
        designationTitle: null,
        label: 'Central · OPD · All designations',
      },
      {
        id: '2',
        projectId: 'proj-h',
        projectName: 'Central',
        departmentId: 'dept-pharm',
        departmentName: 'PHARMACY',
        designationId: 'des-1',
        designationTitle: 'PHARMACY STAFF',
        label: 'Central · PHARMACY · PHARMACY STAFF',
      },
    ];

    expect(
      service.employeeMatchesScopes(
        {
          currentDepartmentId: 'dept-opd',
          currentDesignation: 'LHV',
          currentBranch: {
            projectId: 'proj-h',
            project: { type: ProjectType.HOSPITAL },
          },
        },
        scopes,
      ),
    ).toBe(true);

    expect(
      service.employeeMatchesScopes(
        {
          currentDepartmentId: 'dept-pharm',
          currentDesignation: 'PHARMACY STAFF',
          currentBranch: {
            projectId: 'proj-h',
            project: { type: ProjectType.HOSPITAL },
          },
        },
        scopes,
      ),
    ).toBe(true);

    expect(
      service.employeeMatchesScopes(
        {
          currentDepartmentId: 'dept-pharm',
          currentDesignation: 'RECEPTIONIST',
          currentBranch: {
            projectId: 'proj-h',
            project: { type: ProjectType.HOSPITAL },
          },
        },
        scopes,
      ),
    ).toBe(false);

    expect(
      service.employeeMatchesScopes(
        {
          currentDepartmentId: 'dept-opd',
          currentDesignation: 'LHV',
          currentBranch: {
            projectId: 'proj-other',
            project: { type: ProjectType.HOSPITAL },
          },
        },
        scopes,
      ),
    ).toBe(false);
  });

  it('builds OR employee predicates for scopes', () => {
    const where = service.employeeWhereForScopes([
      {
        id: '1',
        projectId: 'proj-h',
        projectName: 'Central',
        departmentId: 'dept-opd',
        departmentName: 'OPD',
        designationId: null,
        designationTitle: null,
        label: 'x',
      },
      {
        id: '2',
        projectId: 'proj-h',
        projectName: 'Central',
        departmentId: 'dept-pharm',
        departmentName: 'PHARMACY',
        designationId: 'des-1',
        designationTitle: 'PHARMACY STAFF',
        label: 'y',
      },
    ]);

    expect(where).toEqual({
      OR: [
        {
          currentDepartmentId: 'dept-opd',
          currentBranch: {
            projectId: 'proj-h',
            project: { type: ProjectType.HOSPITAL },
          },
        },
        {
          currentDepartmentId: 'dept-pharm',
          currentBranch: {
            projectId: 'proj-h',
            project: { type: ProjectType.HOSPITAL },
          },
          currentDesignation: {
            equals: 'PHARMACY STAFF',
            mode: 'insensitive',
          },
        },
      ],
    });
  });
});
