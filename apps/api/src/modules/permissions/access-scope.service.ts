import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Permission, Prisma, ProjectType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isHospitalAssignableDepartment } from '../../common/org-structure';
import { buildEffectiveRoles } from '../../common/user-roles.util';
import {
  roleDefaultAllows,
  rolesDefaultAllow,
} from './permissions.constants';

export type ManagerScopeDto = {
  projectId: string;
  departmentId: string;
  designationId?: string | null;
};

export type ManagerScopeView = {
  id: string;
  projectId: string;
  projectName: string;
  departmentId: string;
  departmentName: string;
  designationId: string | null;
  designationTitle: string | null;
  label: string;
};

export type ActorAccessContext = {
  userId: string;
  roles: UserRole[];
  isGlobal: boolean;
  managerScopes: ManagerScopeView[];
  hasManagerScopes: boolean;
};

const EXECUTIVE_ROLES: UserRole[] = [
  UserRole.PRESIDENT,
  UserRole.FOUNDER,
  UserRole.CHAIRMAN,
];

@Injectable()
export class AccessScopeService {
  constructor(private prisma: PrismaService) {}

  isExecutiveRole(role: UserRole): boolean {
    return EXECUTIVE_ROLES.includes(role);
  }

  rejectExecutiveAdditionalRoles(roles: UserRole[]): UserRole[] {
    return roles.filter((role) => !this.isExecutiveRole(role));
  }

  assertNoExecutiveAdditionalRoles(roles: UserRole[]) {
    const blocked = roles.filter((role) => this.isExecutiveRole(role));
    if (blocked.length) {
      throw new BadRequestException(
        `Executive roles cannot be assigned as additional roles: ${blocked.join(', ')}`,
      );
    }
  }

  async getActorContext(userId: string): Promise<ActorAccessContext> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        additionalRoles: { select: { role: true } },
        managerScopes: {
          where: { isActive: true },
          select: {
            id: true,
            projectId: true,
            departmentId: true,
            designationId: true,
            project: { select: { id: true, name: true, type: true } },
            department: { select: { id: true, name: true } },
            designation: { select: { id: true, title: true } },
          },
        },
      },
    });

    if (!user) {
      return {
        userId,
        roles: [],
        isGlobal: false,
        managerScopes: [],
        hasManagerScopes: false,
      };
    }

    const roles = buildEffectiveRoles(user.role, user.additionalRoles);
    const managerScopes = user.managerScopes
      .filter((scope) => scope.project.type === ProjectType.HOSPITAL)
      .map((scope) => this.toScopeView(scope));

    return {
      userId,
      roles,
      isGlobal:
        roles.includes(UserRole.SUPER_ADMIN) ||
        roles.includes(UserRole.HR_EXECUTIVE),
      managerScopes,
      hasManagerScopes: managerScopes.length > 0,
    };
  }

  async userHasManagerScopes(userId: string): Promise<boolean> {
    const count = await this.prisma.userManagerScope.count({
      where: {
        userId,
        isActive: true,
        project: { type: ProjectType.HOSPITAL },
      },
    });
    return count > 0;
  }

  /**
   * Global permission check, plus Admin Officer defaults when the user has
   * any hospital manager scopes (capability only — row matching is separate).
   */
  async userHasPermissionOrScopedCapability(
    userId: string,
    role: UserRole,
    permission: Permission,
  ): Promise<boolean> {
    const context = await this.getActorContext(userId);
    const roles = context.roles.length ? context.roles : [role];

    if (context.isGlobal || roles.includes(UserRole.SUPER_ADMIN)) {
      return true;
    }

    const override = await this.prisma.userPermission.findUnique({
      where: { userId_permission: { userId, permission } },
    });
    if (override) return override.granted;

    if (rolesDefaultAllow(roles, permission)) return true;

    if (
      context.hasManagerScopes &&
      roleDefaultAllows(UserRole.ADMIN_OFFICER, permission)
    ) {
      return true;
    }

    return false;
  }

  /** Prisma predicate for employees visible via manager scopes. */
  employeeWhereForScopes(
    scopes: ManagerScopeView[],
  ): Prisma.EmployeeWhereInput | null {
    if (!scopes.length) return null;

    return {
      OR: scopes.map((scope) => {
        const clause: Prisma.EmployeeWhereInput = {
          currentDepartmentId: scope.departmentId,
          currentBranch: {
            projectId: scope.projectId,
            project: { type: ProjectType.HOSPITAL },
          },
        };
        if (scope.designationId && scope.designationTitle) {
          clause.currentDesignation = {
            equals: scope.designationTitle,
            mode: 'insensitive',
          };
        }
        return clause;
      }),
    };
  }

  /**
   * Department/designation list filters match either actual employee placement
   * or an active hospital manager scope on the linked user account.
   */
  employeeMatchesDepartmentDesignationFilter(filters: {
    departmentId?: string;
    designation?: string;
  }): Prisma.EmployeeWhereInput | undefined {
    const departmentId = filters.departmentId?.trim() || undefined;
    const designation = filters.designation?.trim() || undefined;
    if (!departmentId && !designation) return undefined;

    const actual: Prisma.EmployeeWhereInput = {};
    if (departmentId) {
      actual.currentDepartmentId = departmentId;
    }
    if (designation) {
      actual.currentDesignation = {
        equals: designation,
        mode: 'insensitive',
      };
    }

    const scopeClause: Prisma.UserManagerScopeWhereInput = {
      isActive: true,
      project: { type: ProjectType.HOSPITAL },
    };
    if (departmentId) {
      scopeClause.departmentId = departmentId;
    }
    if (designation) {
      // Department-wide scopes (no designation) count for department filters only.
      // For designation filters, require an exact designation-title match.
      scopeClause.designation = {
        title: { equals: designation, mode: 'insensitive' },
      };
    }

    return {
      OR: [
        actual,
        {
          user: {
            managerScopes: {
              some: scopeClause,
            },
          },
        },
      ],
    };
  }

  /**
   * Row filter for list queries.
   * - Global actors: no extra filter
   * - Actors with global role permissions: no extra filter from scopes
   * - Actors who only have scopes (or need scoped narrowing): apply scope OR
   *   when they lack unrestricted role access for the permission
   */
  async employeeListWhere(
    userId: string,
    role: UserRole,
    permission?: Permission,
  ): Promise<Prisma.EmployeeWhereInput | undefined> {
    const context = await this.getActorContext(userId);
    if (context.isGlobal) return undefined;

    const roles = context.roles.length ? context.roles : [role];
    const hasGlobalRoleAccess =
      !permission || rolesDefaultAllow(roles, permission);

    // If their system roles already grant the permission globally, do not
    // restrict by scope. Scopes only expand access for users who rely on them.
    if (hasGlobalRoleAccess && !context.hasManagerScopes) {
      return undefined;
    }
    if (hasGlobalRoleAccess) {
      return undefined;
    }

    if (!context.hasManagerScopes) {
      // No global access and no scopes → deny all rows
      return { id: { in: [] } };
    }

    return this.employeeWhereForScopes(context.managerScopes) ?? {
      id: { in: [] },
    };
  }

  /**
   * Narrow list queries for users who rely on hospital manager scopes.
   * Org-wide staff roles keep current unrestricted visibility; scope-only
   * users (e.g. EMPLOYEE + department scopes) are limited to matching rows.
   */
  async narrowEmployeeWhereForActor(
    userId: string,
    role: UserRole,
    existingWhere: Prisma.EmployeeWhereInput = {},
  ): Promise<Prisma.EmployeeWhereInput> {
    const context = await this.getActorContext(userId);
    if (context.isGlobal) return existingWhere;

    const roles = context.roles.length ? context.roles : [role];
    const hasOrgWideStaffRole = roles.some(
      (r) => r !== UserRole.EMPLOYEE,
    );

    if (hasOrgWideStaffRole) {
      return existingWhere;
    }

    if (!context.hasManagerScopes) {
      return existingWhere;
    }

    const scopeWhere = this.employeeWhereForScopes(context.managerScopes);
    if (!scopeWhere) return { id: { in: [] } };

    return {
      AND: [existingWhere, scopeWhere],
    };
  }

  /**
   * Permission-aware list filter for mutating/reporting endpoints.
   * - Super Admin / HR Executive: unrestricted
   * - Role already allows permission globally: unrestricted
   * - Otherwise if scopes exist and Admin Officer allows: restrict to scopes
   * - Else: empty set
   */
  async applyEmployeeScopeFilter(
    userId: string,
    role: UserRole,
    permission: Permission,
    existingWhere: Prisma.EmployeeWhereInput = {},
  ): Promise<Prisma.EmployeeWhereInput> {
    const context = await this.getActorContext(userId);
    if (context.isGlobal) return existingWhere;

    const roles = context.roles.length ? context.roles : [role];
    const override = await this.prisma.userPermission.findUnique({
      where: { userId_permission: { userId, permission } },
    });

    if (override?.granted === false) {
      return { id: { in: [] } };
    }

    const roleAllows =
      override?.granted === true || rolesDefaultAllow(roles, permission);
    const scopeWhere = this.employeeWhereForScopes(context.managerScopes);

    if (roleAllows) {
      return existingWhere;
    }

    if (scopeWhere && roleDefaultAllows(UserRole.ADMIN_OFFICER, permission)) {
      return {
        AND: [existingWhere, scopeWhere],
      };
    }

    return { id: { in: [] } };
  }

  async assertEmployeeAccess(
    userId: string,
    role: UserRole,
    permission: Permission,
    employeeId: string,
  ): Promise<void> {
    const context = await this.getActorContext(userId);
    if (context.isGlobal) return;

    const roles = context.roles.length ? context.roles : [role];
    const override = await this.prisma.userPermission.findUnique({
      where: { userId_permission: { userId, permission } },
    });
    if (override?.granted === false) {
      throw new ForbiddenException('Permission denied');
    }

    if (override?.granted === true || rolesDefaultAllow(roles, permission)) {
      return;
    }

    if (
      !context.hasManagerScopes ||
      !roleDefaultAllows(UserRole.ADMIN_OFFICER, permission)
    ) {
      throw new ForbiddenException('Permission denied');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        currentDepartmentId: true,
        currentDesignation: true,
        currentBranch: {
          select: {
            projectId: true,
            project: { select: { type: true } },
          },
        },
      },
    });

    if (!employee) {
      throw new ForbiddenException('Employee not found or not in your scope');
    }

    if (!this.employeeMatchesScopes(employee, context.managerScopes)) {
      throw new ForbiddenException(
        'You do not have access to this employee within your hospital scope',
      );
    }
  }

  employeeMatchesScopes(
    employee: {
      currentDepartmentId?: string | null;
      currentDesignation?: string | null;
      currentBranch?: {
        projectId?: string | null;
        project?: { type?: ProjectType | null } | null;
      } | null;
    },
    scopes: ManagerScopeView[],
  ): boolean {
    if (!scopes.length) return false;
    const projectId = employee.currentBranch?.projectId;
    const projectType = employee.currentBranch?.project?.type;
    if (!projectId || projectType !== ProjectType.HOSPITAL) return false;
    if (!employee.currentDepartmentId) return false;

    const designation = employee.currentDesignation?.trim().toUpperCase() ?? '';

    return scopes.some((scope) => {
      if (scope.projectId !== projectId) return false;
      if (scope.departmentId !== employee.currentDepartmentId) return false;
      if (!scope.designationId) return true;
      return (
        !!scope.designationTitle &&
        scope.designationTitle.trim().toUpperCase() === designation
      );
    });
  }

  async getHospitalScopeOptions() {
    const projects = await this.prisma.project.findMany({
      where: { type: ProjectType.HOSPITAL, isActive: true },
      select: {
        id: true,
        name: true,
        projectDepartments: {
          select: {
            department: {
              select: {
                id: true,
                name: true,
                sortOrder: true,
                isActive: true,
                isDeleted: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const designations = await this.prisma.designation.findMany({
      where: { isActive: true, isDeleted: false },
      select: { id: true, title: true, category: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });

    return projects.map((project) => {
      const departments = project.projectDepartments
        .map((pd) => pd.department)
        .filter(
          (dept) =>
            dept.isActive &&
            !dept.isDeleted &&
            isHospitalAssignableDepartment(dept.name),
        )
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        )
        .map((dept) => {
          const deptName = dept.name.trim().toUpperCase();
          const deptDesignations = designations.filter(
            (d) => d.category.trim().toUpperCase() === deptName,
          );
          return {
            id: dept.id,
            name: dept.name,
            designations: deptDesignations.map((d) => ({
              id: d.id,
              title: d.title,
            })),
          };
        });

      return {
        id: project.id,
        name: project.name,
        type: ProjectType.HOSPITAL,
        departments,
      };
    });
  }

  async listManagerScopes(userId: string): Promise<ManagerScopeView[]> {
    const scopes = await this.prisma.userManagerScope.findMany({
      where: { userId, isActive: true },
      select: {
        id: true,
        projectId: true,
        departmentId: true,
        designationId: true,
        project: { select: { id: true, name: true, type: true } },
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return scopes
      .filter((scope) => scope.project.type === ProjectType.HOSPITAL)
      .map((scope) => this.toScopeView(scope));
  }

  async replaceManagerScopes(
    userId: string,
    scopes: ManagerScopeDto[],
  ): Promise<ManagerScopeView[]> {
    const normalized = this.normalizeScopeDtos(scopes);
    await this.validateScopeDtos(normalized);

    await this.prisma.$transaction(async (tx) => {
      await tx.userManagerScope.deleteMany({ where: { userId } });
      if (normalized.length) {
        await tx.userManagerScope.createMany({
          data: normalized.map((scope) => ({
            userId,
            projectId: scope.projectId,
            departmentId: scope.departmentId,
            designationId: scope.designationId ?? null,
            isActive: true,
          })),
        });
      }
    });

    return this.listManagerScopes(userId);
  }

  private normalizeScopeDtos(scopes: ManagerScopeDto[]): ManagerScopeDto[] {
    const seen = new Set<string>();
    const result: ManagerScopeDto[] = [];
    for (const scope of scopes) {
      const key = `${scope.projectId}|${scope.departmentId}|${scope.designationId ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        projectId: scope.projectId,
        departmentId: scope.departmentId,
        designationId: scope.designationId || null,
      });
    }
    return result;
  }

  private async validateScopeDtos(scopes: ManagerScopeDto[]) {
    for (const scope of scopes) {
      const project = await this.prisma.project.findUnique({
        where: { id: scope.projectId },
        select: { id: true, type: true, isActive: true },
      });
      if (!project || !project.isActive || project.type !== ProjectType.HOSPITAL) {
        throw new BadRequestException(
          `Invalid hospital project for scope: ${scope.projectId}`,
        );
      }

      const mapping = await this.prisma.projectDepartment.findUnique({
        where: {
          projectId_departmentId: {
            projectId: scope.projectId,
            departmentId: scope.departmentId,
          },
        },
        include: { department: { select: { name: true, isActive: true, isDeleted: true } } },
      });
      if (
        !mapping ||
        !mapping.department.isActive ||
        mapping.department.isDeleted ||
        !isHospitalAssignableDepartment(mapping.department.name)
      ) {
        throw new BadRequestException(
          `Department is not available for this hospital project`,
        );
      }

      if (scope.designationId) {
        const designation = await this.prisma.designation.findFirst({
          where: {
            id: scope.designationId,
            isActive: true,
            isDeleted: false,
          },
        });
        if (!designation) {
          throw new BadRequestException('Invalid designation for scope');
        }
        if (
          designation.category.trim().toUpperCase() !==
          mapping.department.name.trim().toUpperCase()
        ) {
          throw new BadRequestException(
            `Designation ${designation.title} does not belong to department ${mapping.department.name}`,
          );
        }
      }
    }
  }

  private toScopeView(scope: {
    id: string;
    projectId: string;
    departmentId: string;
    designationId: string | null;
    project: { name: string };
    department: { name: string };
    designation: { title: string } | null;
  }): ManagerScopeView {
    const designationTitle = scope.designation?.title ?? null;
    return {
      id: scope.id,
      projectId: scope.projectId,
      projectName: scope.project.name,
      departmentId: scope.departmentId,
      departmentName: scope.department.name,
      designationId: scope.designationId,
      designationTitle,
      label: [
        scope.project.name,
        scope.department.name,
        designationTitle ?? 'All designations',
      ].join(' · '),
    };
  }
}
