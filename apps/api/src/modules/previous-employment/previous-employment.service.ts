import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePreviousEmploymentDto,
  UpdatePreviousEmploymentDto,
} from './previous-employment.dto';

@Injectable()
export class PreviousEmploymentService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePreviousEmploymentDto) {
    await this.ensureEmployeeExists(dto.employeeId);

    return this.prisma.previousEmployment.create({
      data: dto,
    });
  }

  async findAll(employeeId: string) {
    await this.ensureEmployeeExists(employeeId);

    return this.prisma.previousEmployment.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, dto: UpdatePreviousEmploymentDto) {
    await this.findOne(id);

    if (dto.employeeId) {
      await this.ensureEmployeeExists(dto.employeeId);
    }

    return this.prisma.previousEmployment.update({
      where: { id },
      data: dto,
    });
  }

  async delete(id: string) {
    await this.findOne(id);

    await this.prisma.previousEmployment.delete({
      where: { id },
    });

    return { message: 'Deleted successfully' };
  }

  private async findOne(id: string) {
    const record = await this.prisma.previousEmployment.findUnique({
      where: { id },
    });

    if (!record) {
      throw new NotFoundException(
        `Previous employment record with id ${id} not found`,
      );
    }

    return record;
  }

  private async ensureEmployeeExists(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }
  }
}
