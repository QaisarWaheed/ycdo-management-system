import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateShiftDto, UpdateShiftDto } from './shifts.dto';

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateShiftDto) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, isActive: true },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with id ${dto.branchId} not found`);
    }

    const duplicate = await this.prisma.shift.findFirst({
      where: { branchId: dto.branchId, name: dto.name, isActive: true },
    });

    if (duplicate) {
      throw new ConflictException(
        `Shift "${dto.name}" already exists for this branch`,
      );
    }

    return this.prisma.shift.create({
      data: dto,
      include: { branch: { select: { name: true } } },
    });
  }

  findAll(branchId?: string) {
    const where: Prisma.ShiftWhereInput = { isActive: true };

    if (branchId) {
      where.branchId = branchId;
    }

    return this.prisma.shift.findMany({
      where,
      include: {
        branch: { select: { name: true } },
        _count: { select: { employees: true } },
      },
      orderBy: { startTime: 'asc' },
    });
  }

  async findOne(id: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: { branch: { select: { name: true } } },
    });

    if (!shift) {
      throw new NotFoundException(`Shift with id ${id} not found`);
    }

    return shift;
  }

  async update(id: string, dto: UpdateShiftDto) {
    await this.findOne(id);

    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, isActive: true },
      });
      if (!branch) {
        throw new NotFoundException(`Branch with id ${dto.branchId} not found`);
      }
    }

    return this.prisma.shift.update({
      where: { id },
      data: dto,
      include: { branch: { select: { name: true } } },
    });
  }

  async deactivate(id: string) {
    await this.findOne(id);

    const activeEmployees = await this.prisma.employee.count({
      where: {
        shiftId: id,
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.TRAINEE] },
      },
    });

    if (activeEmployees > 0) {
      throw new BadRequestException(
        'Cannot deactivate shift with active employees. Reassign employees first.',
      );
    }

    return this.prisma.shift.update({
      where: { id },
      data: { isActive: false },
    });
  }

  getShiftsByBranch(branchId: string) {
    return this.prisma.shift.findMany({
      where: { branchId, isActive: true },
      include: {
        _count: { select: { employees: true } },
      },
      orderBy: { startTime: 'asc' },
    });
  }
}
