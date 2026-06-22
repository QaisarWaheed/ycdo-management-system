import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './departments.dto';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateDepartmentDto) {
    await this.ensureBranchExists(dto.branchId);

    return this.prisma.department.create({
      data: dto,
      include: {
        branch: { select: { name: true } },
      },
    });
  }

  findAll(branchId?: string) {
    return this.prisma.department.findMany({
      where: {
        isActive: true,
        ...(branchId ? { branchId } : {}),
      },
      include: {
        branch: { select: { name: true } },
        _count: { select: { employees: true } },
      },
    });
  }

  async findOne(id: string) {
    const department = await this.prisma.department.findUnique({
      where: { id },
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
        branch: { select: { name: true } },
      },
    });
  }

  async deactivate(id: string) {
    await this.findOne(id);

    return this.prisma.department.update({
      where: { id },
      data: { isActive: false },
    });
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
