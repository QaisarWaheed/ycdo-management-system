import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
import { inferShiftNameFromStartTime } from '../../common/shift-inference.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateShiftDto, UpdateShiftDto } from './shifts.dto';

const ALLOWED_SHIFT_NAMES = ['Morning', 'Evening', 'Night', '24 Hours'];

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateShiftDto) {
    const sibling = await this.prisma.shift.findFirst({
      where: { startTime: dto.startTime, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const name = sibling?.name ?? inferShiftNameFromStartTime(dto.startTime);

    if (!ALLOWED_SHIFT_NAMES.includes(name)) {
      throw new BadRequestException(
        'Shift name must be Morning, Evening, Night, or 24 Hours',
      );
    }

    const duplicate = await this.prisma.shift.findFirst({
      where: {
        name,
        startTime: dto.startTime,
        endTime: dto.endTime,
        isActive: true,
      },
    });

    if (duplicate) {
      throw new ConflictException(
        `A shift with check-in ${dto.startTime} and checkout ${dto.endTime} already exists`,
      );
    }

    return this.prisma.shift.create({
      data: {
        name,
        startTime: dto.startTime,
        endTime: dto.endTime,
        branchId: null,
      },
      include: {
        _count: { select: { employees: true } },
      },
    });
  }

  findAll(_branchId?: string) {
    return this.prisma.shift.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { employees: true } },
      },
      orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: {
        _count: { select: { employees: true } },
      },
    });

    if (!shift) {
      throw new NotFoundException(`Shift with id ${id} not found`);
    }

    return shift;
  }

  async update(id: string, dto: UpdateShiftDto) {
    const current = await this.findOne(id);

    let nextName = dto.name ?? current.name;
    const nextStart = dto.startTime ?? current.startTime;
    const nextEnd = dto.endTime ?? current.endTime;

    if (dto.startTime && dto.startTime !== current.startTime) {
      const sibling = await this.prisma.shift.findFirst({
        where: {
          startTime: dto.startTime,
          isActive: true,
          id: { not: id },
        },
        orderBy: { createdAt: 'asc' },
      });
      nextName = sibling?.name ?? inferShiftNameFromStartTime(dto.startTime);
    }

    if (dto.name && !ALLOWED_SHIFT_NAMES.includes(dto.name)) {
      throw new BadRequestException(
        'Shift name must be Morning, Evening, Night, or 24 Hours',
      );
    }

    const duplicate = await this.prisma.shift.findFirst({
      where: {
        id: { not: id },
        name: nextName,
        startTime: nextStart,
        endTime: nextEnd,
        isActive: true,
      },
    });

    if (duplicate) {
      throw new ConflictException(
        `A shift with check-in ${nextStart} and checkout ${nextEnd} already exists`,
      );
    }

    return this.prisma.shift.update({
      where: { id },
      data: {
        name: nextName,
        ...(dto.startTime !== undefined ? { startTime: dto.startTime } : {}),
        ...(dto.endTime !== undefined ? { endTime: dto.endTime } : {}),
      },
      include: {
        _count: { select: { employees: true } },
      },
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

  getShiftsByBranch(_branchId: string) {
    return this.findAll();
  }
}
