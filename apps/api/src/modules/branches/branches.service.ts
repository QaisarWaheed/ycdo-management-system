import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBranchDto, UpdateBranchDto } from './branches.dto';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: dto });
  }

  findAll() {
    return this.prisma.branch.findMany({
      where: { isActive: true },
      include: {
        project: { select: { name: true } },
        _count: {
          select: { employees: true, departments: true, shifts: true },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  findByProject(projectId: string) {
    return this.prisma.branch.findMany({
      where: { projectId, isActive: true },
      include: {
        departments: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        shifts: { where: { isActive: true }, orderBy: { startTime: 'asc' } },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOne(id: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      include: {
        project: true,
        departments: true,
        shifts: { where: { isActive: true }, orderBy: { startTime: 'asc' } },
      },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with id ${id} not found`);
    }

    return branch;
  }

  async update(id: string, dto: UpdateBranchDto) {
    await this.findOne(id);

    return this.prisma.branch.update({
      where: { id },
      data: dto,
    });
  }

  async deactivate(id: string) {
    await this.findOne(id);

    return this.prisma.branch.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
