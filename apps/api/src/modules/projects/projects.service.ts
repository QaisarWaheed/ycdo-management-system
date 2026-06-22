import { Injectable, NotFoundException } from '@nestjs/common';
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

  findAll() {
    return this.prisma.project.findMany({
      include: {
        _count: { select: { branches: true } },
        branches: {
          include: {
            _count: { select: { employees: true } },
          },
        },
      },
      orderBy: { type: 'asc' },
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        branches: {
          include: { departments: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with id ${id} not found`);
    }

    return project;
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

    return this.prisma.project.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
