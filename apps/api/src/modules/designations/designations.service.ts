import { Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateDesignationDto,
  DesignationQueryDto,
  UpdateDesignationDto,
} from './designations.dto';

@Injectable()
export class DesignationsService {
  constructor(private prisma: PrismaService) {}

  findAll(query?: DesignationQueryDto) {
    const where: Prisma.DesignationWhereInput = {
      isActive: true,
      isDeleted: false,
    };

    if (query?.categories) {
      const categories = query.categories
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (categories.length > 0) {
        where.OR = categories.map((category) => ({
          category: { equals: category, mode: 'insensitive' },
        }));
      }
    } else if (query?.category) {
      where.category = { equals: query.category, mode: 'insensitive' };
    }

    return this.prisma.designation.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    }).then(async (designations) => {
      const designationsWithCounts = await Promise.all(
        designations.map(async (d) => {
          const employeesCount = await this.prisma.employee.count({
            where: {
              currentDesignation: d.title,
              status: {
                in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED],
              },
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
    return this.prisma.designation.create({ data: dto });
  }

  async update(id: string, dto: UpdateDesignationDto) {
    await this.ensureExists(id);
    return this.prisma.designation.update({ where: { id }, data: dto });
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
