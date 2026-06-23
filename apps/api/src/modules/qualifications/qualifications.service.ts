import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateQualificationDto,
  UpdateQualificationDto,
} from './qualifications.dto';

@Injectable()
export class QualificationsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateQualificationDto) {
    await this.ensureEmployeeExists(dto.employeeId);

    return this.prisma.academicQualification.create({
      data: dto,
    });
  }

  async findAll(employeeId: string) {
    await this.ensureEmployeeExists(employeeId);

    return this.prisma.academicQualification.findMany({
      where: { employeeId },
      orderBy: [{ qualType: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async update(id: string, dto: UpdateQualificationDto) {
    await this.findOne(id);

    if (dto.employeeId) {
      await this.ensureEmployeeExists(dto.employeeId);
    }

    return this.prisma.academicQualification.update({
      where: { id },
      data: dto,
    });
  }

  async delete(id: string) {
    await this.findOne(id);

    await this.prisma.academicQualification.delete({
      where: { id },
    });

    return { message: 'Deleted successfully' };
  }

  private async findOne(id: string) {
    const qualification = await this.prisma.academicQualification.findUnique({
      where: { id },
    });

    if (!qualification) {
      throw new NotFoundException(`Qualification with id ${id} not found`);
    }

    return qualification;
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
