import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
import { mapInBatches } from '../../common/batch.util';
import {
  normalizeDesignationName,
  normalizeOrgName,
} from '../../common/org-structure';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScopeService } from '../permissions/access-scope.service';
import {
  CreateDesignationDto,
  DesignationQueryDto,
  UpdateDesignationDto,
} from './designations.dto';

@Injectable()
export class DesignationsService {
  constructor(
    private prisma: PrismaService,
    private accessScopeService: AccessScopeService,
  ) {}

  findAll(query?: DesignationQueryDto) {
    const where: Prisma.DesignationWhereInput = {
      isActive: true,
      isDeleted: false,
    };

    if (query?.department) {
      const dept = normalizeOrgName(query.department);
      where.category = { equals: dept, mode: 'insensitive' };
    } else if (query?.categories) {
      const categories = query.categories
        .split(',')
        .map((c) => normalizeOrgName(c))
        .filter(Boolean);
      if (categories.length > 0) {
        where.OR = categories.map((category) => ({
          category: { equals: category, mode: 'insensitive' },
        }));
      }
    } else if (query?.category) {
      where.category = {
        equals: normalizeOrgName(query.category),
        mode: 'insensitive',
      };
    }

    return this.prisma.designation
      .findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      })
      .then(async (designations) => {
        const designationsWithCounts = await mapInBatches(
          designations,
          async (d) => {
            const placementOrScope =
              this.accessScopeService.employeeMatchesDepartmentDesignationFilter(
                { designation: d.title },
              );
            const employeesCount = await this.prisma.employee.count({
              where: {
                AND: [
                  placementOrScope ?? {},
                  {
                    status: {
                      in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED],
                    },
                  },
                ],
              },
            });

            return {
              ...d,
              employees: employeesCount,
            };
          },
        );

        return designationsWithCounts;
      });
  }

  async create(dto: CreateDesignationDto) {
    const title = normalizeDesignationName(dto.title);
    if (!title) {
      throw new BadRequestException('Title cannot be empty');
    }
    const category = await this.resolveDepartmentName(dto.category);

    return this.prisma.designation.upsert({
      where: { title },
      update: { category, isActive: true, isDeleted: false },
      create: { title, category },
    });
  }

  async update(id: string, dto: UpdateDesignationDto) {
    const existing = await this.prisma.designation.findFirst({
      where: { id, isDeleted: false },
    });
    if (!existing) {
      throw new NotFoundException(`Designation with id ${id} not found`);
    }

    const data: Prisma.DesignationUpdateInput = {};
    let renamedTo: string | null = null;
    if (dto.title !== undefined) {
      const title = normalizeDesignationName(dto.title);
      if (!title) {
        throw new BadRequestException('Title cannot be empty');
      }
      if (title !== existing.title) {
        renamedTo = title;
      }
      data.title = title;
    }
    if (
      dto.category !== undefined &&
      normalizeOrgName(dto.category) !== normalizeOrgName(existing.category)
    ) {
      data.category = await this.resolveDepartmentName(dto.category);
    }
    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    if (!renamedTo) {
      return this.prisma.designation.update({ where: { id }, data });
    }

    const newTitle = renamedTo;
    // title is @unique, so a hidden (deleted/inactive) row can still hold the
    // name. Block renames onto a visible designation; move hidden ones aside.
    const clash = await this.prisma.designation.findUnique({
      where: { title: newTitle },
    });
    if (clash && clash.isActive && !clash.isDeleted) {
      throw new ConflictException(
        `Designation "${newTitle}" already exists`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (clash) {
        await tx.designation.update({
          where: { id: clash.id },
          data: { title: `${newTitle} (ARCHIVED ${clash.id.slice(0, 8)})` },
        });
      }
      const updated = await tx.designation.update({ where: { id }, data });
      // Employees store the designation as free text; keep them attached.
      await tx.employee.updateMany({
        where: { currentDesignation: existing.title },
        data: { currentDesignation: newTitle },
      });
      return updated;
    });
  }

  async deactivate(id: string) {
    const designation = await this.prisma.designation.findFirst({
      where: { id, isDeleted: false },
    });

    if (!designation) {
      throw new NotFoundException(`Designation with id ${id} not found`);
    }

    const affectedEmployees = await this.prisma.employee.count({
      where: {
        currentDesignation: designation.title,
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] },
      },
    });

    if (affectedEmployees > 0) {
      await this.prisma.employee.updateMany({
        where: {
          currentDesignation: designation.title,
          status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] },
        },
        data: { currentDesignation: null },
      });
    }

    await this.prisma.designation.update({
      where: { id },
      data: { isDeleted: true, isActive: false },
    });

    return { message: 'Deleted', affectedEmployees };
  }

  /** Designation.category must name an active department, or it is orphaned. */
  private async resolveDepartmentName(raw: string) {
    const name = normalizeOrgName(raw);
    const department = await this.prisma.department.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        isActive: true,
        isDeleted: false,
      },
    });
    if (!department) {
      throw new BadRequestException(`Department "${name}" does not exist`);
    }
    return department.name;
  }
}
