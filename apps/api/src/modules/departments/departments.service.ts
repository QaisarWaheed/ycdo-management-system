import { orgWriteError } from '../../common/org-write.util';
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
    if (!name) throw new BadRequestException('Name cannot be empty');

    const existing = await this.prisma.department.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    return this.prisma.department
      .upsert({
        where: { name: existing?.name ?? name },
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
      })
      .catch(orgWriteError);
  }

  async findAll(query?: DepartmentQueryDto) {
    const where: Prisma.DepartmentWhereInput = {
      isActive: true,
      isDeleted: false,
      ...(query?.search?.trim()
        ? {
            name: {
              contains: query.search.trim(),
              mode: 'insensitive' as const,
            },
          }
        : {}),
    };

    const departments = await this.prisma.department.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    const relevant = departments;

    return mapInBatches(relevant, async (department) => {
      const employees = await this.prisma.employee.count({
        where: {
          AND: [
            this.accessScopeService.employeeMatchesDepartmentDesignationFilter({
              departmentId: department.id,
            }) ?? {},
            {
              status: {
                in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED],
              },
            },
          ],
        },
      });
      return {
        ...department,
        _count: { employees },
      };
    });
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
      return this.prisma.department
        .update({ where: { id }, data })
        .catch(orgWriteError);
    }

    const newName = renamedTo;
    // name is @unique, so a hidden (deleted/inactive) row can still hold it.
    const clash = await this.prisma.department.findUnique({
      where: { name: newName },
    });
    if (clash && clash.isActive && !clash.isDeleted) {
      throw new ConflictException(`Department "${newName}" already exists`);
    }

    return this.prisma
      .$transaction(
        async (tx) => {
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
        },
        { timeout: 30_000, maxWait: 20_000 },
      )
      .catch(orgWriteError);
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
