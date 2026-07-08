import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  sortBranchesByHierarchy,
  sortProjectsByType,
} from '../../common/branch-sort.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateProjectDto) {
    const project = await this.prisma.project.create({ data: dto });

    return {
      ...project,
      _count: { branches: 0 },
    };
  }

  async findAll() {
    const projects = await this.prisma.project.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { branches: true } },
        branches: {
          where: { isActive: true },
          include: {
            _count: {
              select: { employees: true, departments: true, shifts: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return sortProjectsByType(projects).map((project) => ({
      ...project,
      branches: sortBranchesByHierarchy(project.branches).map((branch) => ({
        ...branch,
        employeeCount: branch._count.employees,
      })),
    }));
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        branches: {
          where: { isActive: true },
          include: {
            departments: true,
            _count: { select: { employees: true } },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with id ${id} not found`);
    }

    return {
      ...project,
      branches: sortBranchesByHierarchy(project.branches),
    };
  }

  async update(id: string, dto: UpdateProjectDto) {
    await this.findOne(id);

    return this.prisma.project.update({
      where: { id },
      data: dto,
    });
  }

  async deactivate(id: string) {
    await this.findOne(id);

    const linkedBranches = await this.prisma.branch.count({
      where: { projectId: id, isActive: true },
    });

    if (linkedBranches > 0) {
      throw new BadRequestException(
        'Cannot delete project with linked branches.',
      );
    }

    return this.prisma.project.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
