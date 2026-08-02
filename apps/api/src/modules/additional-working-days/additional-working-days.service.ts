import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAdditionalWorkingDayDto } from './additional-working-days.dto';

@Injectable()
export class AdditionalWorkingDaysService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateAdditionalWorkingDayDto, addedById: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with id ${dto.employeeId} not found`);
    }
    if (
      employee.status !== EmployeeStatus.ACTIVE &&
      employee.status !== EmployeeStatus.APPOINTED &&
      employee.status !== EmployeeStatus.TRAINEE
    ) {
      throw new BadRequestException(
        'Additional working days can only be added for active, appointed, or trainee employees',
      );
    }

    const date = this.toDateOnly(dto.date);

    try {
      return await this.prisma.additionalWorkingDay.create({
        data: {
          employeeId: dto.employeeId,
          date,
          note: dto.note?.trim() || null,
          addedById,
        },
        include: {
          addedBy: { select: { id: true, email: true } },
        },
      });
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new BadRequestException(
          'An additional working day already exists for this date',
        );
      }
      throw err;
    }
  }

  findByEmployee(employeeId: string) {
    return this.prisma.additionalWorkingDay.findMany({
      where: { employeeId },
      orderBy: { date: 'desc' },
      include: {
        addedBy: { select: { id: true, email: true } },
      },
    });
  }

  async delete(id: string) {
    const row = await this.prisma.additionalWorkingDay.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException(`Additional working day ${id} not found`);
    }
    await this.prisma.additionalWorkingDay.delete({ where: { id } });
    return { message: 'Additional working day deleted' };
  }

  private toDateOnly(isoDate: string): Date {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Invalid date');
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
}
