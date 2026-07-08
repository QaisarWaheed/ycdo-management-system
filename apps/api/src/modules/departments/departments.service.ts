import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EmployeeStatus } from '@prisma/client';
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
    await this.ensureBranchExists(dto.branchId);

    return this.prisma.department.create({
      data: dto,
      include: {
        branch: { select: { name: true, address: true } },
      },
    });
  }

  findAll(query?: DepartmentQueryDto) {
    const where: Prisma.DepartmentWhereInput = {
      isActive: true,
      isDeleted: false,
    };

    if (query?.branchId) {
      where.branchId = query.branchId;
    }

    return this.prisma.department.findMany({
      where,
      include: {
        branch: { select: { name: true, address: true } },
        _count: { select: { employees: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOne(id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, isDeleted: false },
      include: { branch: true },
    });

    if (!department) {
      throw new NotFoundException(`Department with id ${id} not found`);
    }

    return department;
  }

  async update(id: string, dto: UpdateDepartmentDto) {
    await this.findOne(id);

    if (dto.branchId) {
      await this.ensureBranchExists(dto.branchId);
    }

    return this.prisma.department.update({
      where: { id },
      data: dto,
      include: {
        branch: { select: { name: true, address: true } },
      },
    });
  }

  async deactivate(id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, isDeleted: false },
    });

    if (!department) {
      throw new NotFoundException(`Department with id ${id} not found`);
    }

    // Only unassign currently active/appointed employees.
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

  private async ensureBranchExists(branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, isActive: true },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with id ${branchId} not found`);
    }
  }
}
