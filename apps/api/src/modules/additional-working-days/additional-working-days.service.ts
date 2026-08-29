import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertEmployeeEligibleForAttendance } from '../attendance/attendance-eligibility.util';
import { CreateAdditionalWorkingDayDto } from './additional-working-days.dto';

export const RELIEVER_AWD_NOTE = 'Reliever duty';

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
    assertEmployeeEligibleForAttendance(employee);

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

  /**
   * Option A: profile visibility on the AWD tab when reliever check-out completes.
   * Payroll for these rows stays on RelieverSession (RELIEVER allowance), not AWD.
   */
  async upsertFromRelieverSession(params: {
    relieverSessionId: string;
    employeeId: string;
    date: Date;
    addedById: string;
  }) {
    const date = this.normalizeDateOnly(params.date);

    const existing = await this.prisma.additionalWorkingDay.findUnique({
      where: { relieverSessionId: params.relieverSessionId },
    });
    if (existing) {
      return existing;
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: params.employeeId },
      select: { status: true },
    });
    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${params.employeeId} not found`,
      );
    }
    assertEmployeeEligibleForAttendance(employee);

    try {
      return await this.prisma.additionalWorkingDay.create({
        data: {
          employeeId: params.employeeId,
          date,
          note: RELIEVER_AWD_NOTE,
          addedById: params.addedById,
          relieverSessionId: params.relieverSessionId,
        },
      });
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        // Manual AWD already exists for this employee+date — reliever pay is unaffected.
        return null;
      }
      throw err;
    }
  }

  async delete(id: string) {
    const row = await this.prisma.additionalWorkingDay.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException(`Additional working day ${id} not found`);
    }
    if (row.relieverSessionId) {
      throw new BadRequestException(
        'Reliever duty days are managed from attendance and cannot be deleted here',
      );
    }
    await this.prisma.additionalWorkingDay.delete({ where: { id } });
    return { message: 'Additional working day deleted' };
  }

  private toDateOnly(isoDate: string): Date {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Invalid date');
    }
    return this.normalizeDateOnly(d);
  }

  private normalizeDateOnly(d: Date): Date {
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }
}
