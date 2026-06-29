import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateDesignationDto,
  UpdateDesignationDto,
} from './designations.dto';

@Injectable()
export class DesignationsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.designation.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
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
    await this.ensureExists(id);
    return this.prisma.designation.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private async ensureExists(id: string) {
    const designation = await this.prisma.designation.findUnique({
      where: { id },
    });
    if (!designation) {
      throw new NotFoundException(`Designation with id ${id} not found`);
    }
  }
}
