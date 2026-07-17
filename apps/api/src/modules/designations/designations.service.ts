import { Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
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
        const designationsWithCounts = await Promise.all(
          designations.map(async (d) => {
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
          }),
        );

        return designationsWithCounts;
      });
  }

  create(dto: CreateDesignationDto) {
    const title = normalizeDesignationName(dto.title);
    const category = normalizeOrgName(dto.category);

    return this.prisma.designation.upsert({
      where: { title },
      update: { category, isActive: true, isDeleted: false },
      create: { title, category },
    });
  }

  async update(id: string, dto: UpdateDesignationDto) {
    await this.ensureExists(id);

    const data: Prisma.DesignationUpdateInput = {};
    if (dto.title !== undefined) {
      data.title = normalizeDesignationName(dto.title);
    }
    if (dto.category !== undefined) {
      data.category = normalizeOrgName(dto.category);
    }
    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    return this.prisma.designation.update({ where: { id }, data });
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

  private async ensureExists(id: string) {
    const designation = await this.prisma.designation.findFirst({
      where: { id, isDeleted: false },
    });
    if (!designation) {
      throw new NotFoundException(`Designation with id ${id} not found`);
    }
  }
}
