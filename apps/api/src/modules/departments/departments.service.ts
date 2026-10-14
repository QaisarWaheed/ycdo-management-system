import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { mapInBatches } from '../../common/batch.util';
import { Prisma } from '@prisma/client';
import { EmployeeStatus } from '@prisma/client';
import {
  getDepartmentsForProjectType,
  normalizeDepartmentName,
} from '../../common/org-structure';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScopeService } from '../permissions/access-scope.service';
import {
  CreateDepartmentDto,
  DepartmentQueryDto,
  UpdateDepartmentDto,
} from './departments.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    private prisma: PrismaService,
    private accessScopeService: AccessScopeService,
  ) {}

  async create(dto: CreateDepartmentDto) {
    const name = normalizeDepartmentName(dto.name);

    return this.prisma.department.upsert({
      where: { name },
      update: {
        isActive: true,
        isDeleted: false,
        branchId: null,
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      create: {
        name,
        branchId: null,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async findAll(query?: DepartmentQueryDto) {
    const where: Prisma.DepartmentWhereInput = {
      isActive: true,
      isDeleted: false,
    };

    const departments = await this.prisma.department.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const relevant = await this.scopeToPlacement(departments, query);

    return mapInBatches(
      relevant,
      async (department) => {
        const employees = await this.prisma.employee.count({
          where:
            this.accessScopeService.employeeMatchesDepartmentDesignationFilter({
              departmentId: department.id,
            }),
        });
        return {
          ...department,
          _count: { employees },
        };
      },
    );
  }

  /**
   * Narrows the global department list to the ones that make sense for the
   * requested branch/project. Falls back to the full list when nothing can be
   * resolved, so HR is never left with an empty dropdown.
   */
  private async scopeToPlacement<T extends { id: string; name: string }>(
    departments: T[],
    query?: DepartmentQueryDto,
  ): Promise<T[]> {
    const branchId = query?.branchId?.trim();
    let projectId = query?.projectId?.trim();

    if (!branchId && !projectId) return departments;

    if (branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { projectId: true },
      });
      if (!branch) return departments;
      projectId = branch.projectId ?? undefined;
    }

    if (!projectId) return departments;

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        type: true,
        projectDepartments: { select: { departmentId: true } },
      },
    });
    if (!project) return departments;

    const allowedIds = new Set(
      project.projectDepartments.map((pd) => pd.departmentId),
    );
    const allowedNames = new Set(getDepartmentsForProjectType(project.type));

    // Keep departments already in use at this branch so existing placements
    // stay selectable even if the mapping is incomplete.
    const inUse = await this.prisma.employee.findMany({
      where: {
        currentDepartmentId: { not: null },
        ...(branchId
          ? { currentBranchId: branchId }
          : { currentBranch: { projectId } }),
      },
      select: { currentDepartmentId: true },
      distinct: ['currentDepartmentId'],
    });
    for (const row of inUse) {
      if (row.currentDepartmentId) allowedIds.add(row.currentDepartmentId);
    }

    const scoped = departments.filter(
      (department) =>
        allowedIds.has(department.id) ||
        allowedNames.has(normalizeDepartmentName(department.name)),
    );

    return scoped.length > 0 ? scoped : departments;
  }

  async findOne(id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, isDeleted: false },
    });

    if (!department) {
      throw new NotFoundException(`Department with id ${id} not found`);
    }

    return department;
  }

  async update(id: string, dto: UpdateDepartmentDto) {
    const existing = await this.findOne(id);

    const data: Prisma.DepartmentUpdateInput = {};
    let renamedTo: string | null = null;
    if (dto.name !== undefined) {
      const name = normalizeDepartmentName(dto.name);
      if (!name) {
        throw new BadRequestException('Name cannot be empty');
      }
      if (name !== existing.name) {
        renamedTo = name;
      }
      data.name = name;
    }
    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
    }

    if (!renamedTo) {
      return this.prisma.department.update({ where: { id }, data });
    }

    const newName = renamedTo;
    // name is @unique, so a hidden (deleted/inactive) row can still hold it.
    const clash = await this.prisma.department.findUnique({
      where: { name: newName },
    });
    if (clash && clash.isActive && !clash.isDeleted) {
      throw new ConflictException(`Department "${newName}" already exists`);
    }

    return this.prisma.$transaction(async (tx) => {
      if (clash) {
        await tx.department.update({
          where: { id: clash.id },
          data: { name: `${newName} (ARCHIVED ${clash.id.slice(0, 8)})` },
        });
      }
      const updated = await tx.department.update({ where: { id }, data });
      // Designation.category stores the department name as text; without this
      // the designations split off under the old name.
      await tx.designation.updateMany({
        where: { category: { equals: existing.name, mode: 'insensitive' } },
        data: { category: newName },
      });
      return updated;
    });
  }

  async deactivate(id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, isDeleted: false },
    });

    if (!department) {
      throw new NotFoundException(`Department with id ${id} not found`);
    }

    const affectedEmployees = await this.prisma.employee.count({
      where: {
        currentDepartmentId: id,
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] },
      },
    });

    if (affectedEmployees > 0) {
      await this.prisma.employee.updateMany({
        where: {
          currentDepartmentId: id,
          status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] },
        },
        data: { currentDepartmentId: null },
      });
    }

    await this.prisma.department.update({
      where: { id },
      data: { isDeleted: true, isActive: false },
    });

    return { message: 'Deleted', affectedEmployees };
  }

  getDepartmentsByBranch(branchId: string) {
    return this.findAll({ branchId });
  }
}
