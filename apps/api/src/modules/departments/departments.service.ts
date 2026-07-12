import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EmployeeStatus } from '@prisma/client';
import { normalizeDepartmentName } from '../../common/org-structure';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateDepartmentDto,
  DepartmentQueryDto,
  UpdateDepartmentDto,
} from './departments.dto';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

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

  findAll(_query?: DepartmentQueryDto) {
    const where: Prisma.DepartmentWhereInput = {
      isActive: true,
      isDeleted: false,
    };

    return this.prisma.department.findMany({
      where,
      include: {
        _count: { select: { employees: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
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
    await this.findOne(id);

    const data: Prisma.DepartmentUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = normalizeDepartmentName(dto.name);
    }
    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
    }

    return this.prisma.department.update({
      where: { id },
      data,
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

  getDepartmentsByBranch(_branchId: string) {
    return this.findAll();
  }
}
