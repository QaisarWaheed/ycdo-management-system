import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { sortBranchesByHierarchy } from '../../common/branch-sort.util';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchQueryDto, CreateBranchDto, UpdateBranchDto } from './branches.dto';

const branchInclude = {
  project: { select: { name: true, type: true } },
  _count: {
    select: { employees: true, departments: true, shifts: true },
  },
} as const;

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: dto });
  }

  async findAll(query?: BranchQueryDto) {
    const where: Prisma.BranchWhereInput = { isActive: true };

    if (query?.projectId) {
      where.projectId = query.projectId;
    }

    if (query?.project) {
      where.project = { type: query.project };
    }

    const shouldGroupByName = query?.groupByName === 'true';

    const branches = await this.prisma.branch.findMany({
      where,
      include: branchInclude,
    });

    const sorted = sortBranchesByHierarchy(branches).map((branch) => ({
      ...branch,
      employeeCount: branch._count.employees,
    }));

    if (!shouldGroupByName) {
      return sorted;
    }

    const groups = new Map<string, typeof sorted[number][]>();

    for (const b of sorted) {
      const key = b.name;
      const current = groups.get(key) ?? [];
      current.push(b);
      groups.set(key, current);
    }

    return [...groups.entries()]
      .filter(([, arr]) => arr.length > 1)
      .map(([name, branches]) => ({ name, branches }));
  }

  findByProject(projectId: string) {
    return this.prisma.branch
      .findMany({
        where: { projectId, isActive: true },
        include: {
          project: { select: { name: true, type: true } },
          _count: {
            select: { employees: true, departments: true, shifts: true },
          },
        },
        orderBy: { sortOrder: 'asc' },
      })
      .then((branches) =>
        sortBranchesByHierarchy(branches).map((branch) => ({
          ...branch,
          employeeCount: branch._count.employees,
        })),
      );
  }

  async findOne(id: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with id ${id} not found`);
    }

    const [departments, shifts] = await Promise.all([
      this.prisma.department.findMany({
        where: { isActive: true, isDeleted: false },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.shift.findMany({
        where: { isActive: true },
        orderBy: { startTime: 'asc' },
        include: { _count: { select: { employees: true } } },
      }),
    ]);

    return { ...branch, departments, shifts };
  }

  async update(id: string, dto: UpdateBranchDto) {
    await this.findOne(id);

    const data = { ...dto };
    if (dto.abbreviation !== undefined) {
      data.abbreviation = dto.abbreviation.trim() || null;
    }

    return this.prisma.branch.update({
      where: { id },
      data,
    });
  }

  async deactivate(id: string) {
    await this.findOne(id);

    const assignedEmployees = await this.prisma.employee.count({
      where: { currentBranchId: id },
    });

    if (assignedEmployees > 0) {
      throw new BadRequestException(
        'Cannot delete branch with assigned employees.\nReassign employees first.',
      );
    }

    return this.prisma.branch.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
