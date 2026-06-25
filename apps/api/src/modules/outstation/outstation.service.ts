import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  OutstationStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateOutstationDto,
  OutstationQueryDto,
  UpdateOutstationStatusDto,
} from './outstation.dto';

const employeeInclude = {
  employee: {
    select: {
      firstName: true,
      lastName: true,
      employeeCode: true,
      currentBranch: { select: { name: true } },
    },
  },
} satisfies Prisma.BranchChangeRequestInclude;

@Injectable()
export class OutstationService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateOutstationDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException('Employee is not active');
    }

    const startDate = this.toDateOnly(new Date(dto.startDate));
    const endDate = this.toDateOnly(new Date(dto.endDate));

    if (startDate > endDate) {
      throw new BadRequestException(
        'Start date must be before or equal to end date',
      );
    }

    const duration = this.calculateDuration(startDate, endDate);

    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.branchChangeRequest.create({
        data: {
          employeeId: dto.employeeId,
          district: dto.district,
          purpose: dto.purpose,
          startDate,
          endDate,
          duration,
          notes: dto.notes,
        },
        include: employeeInclude,
      });

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'OUTSTATION_SUBMITTED',
          message: `Your outstation request to ${dto.district} has been submitted`,
        },
      });

      return created;
    });

    return request;
  }

  findAll(query: OutstationQueryDto) {
    const where: Prisma.BranchChangeRequestWhereInput = {};

    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }

    if (query.district) {
      where.district = { contains: query.district, mode: 'insensitive' };
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.startDate) {
      where.startDate = {
        gte: this.toDateOnly(new Date(query.startDate)),
      };
    }

    if (query.endDate) {
      where.endDate = {
        lte: this.toDateOnly(new Date(query.endDate)),
      };
    }

    return this.prisma.branchChangeRequest.findMany({
      where,
      include: employeeInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const request = await this.prisma.branchChangeRequest.findUnique({
      where: { id },
      include: employeeInclude,
    });

    if (!request) {
      throw new NotFoundException(`Outstation request with id ${id} not found`);
    }

    return request;
  }

  async updateStatus(
    id: string,
    dto: UpdateOutstationStatusDto,
    actingUserId: string,
  ) {
    const request = await this.findOne(id);

    if (
      request.status === OutstationStatus.COMPLETED ||
      request.status === OutstationStatus.REJECTED
    ) {
      throw new BadRequestException(
        `Cannot update status of a ${request.status.toLowerCase()} request`,
      );
    }

    const data: Prisma.BranchChangeRequestUpdateInput = {
      status: dto.status,
    };

    if (dto.status === OutstationStatus.APPROVED) {
      data.approvedBy = dto.approvedBy;
      data.approvedAt = new Date();
    }

    const statusMessages: Partial<Record<OutstationStatus, string>> = {
      [OutstationStatus.APPROVED]: `Your outstation request to ${request.district} has been approved`,
      [OutstationStatus.REJECTED]: `Your outstation request to ${request.district} has been rejected`,
      [OutstationStatus.COMPLETED]: `Your outstation request to ${request.district} has been marked completed`,
    };

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.branchChangeRequest.update({
        where: { id },
        data,
        include: employeeInclude,
      });

      const message = statusMessages[dto.status];
      if (message) {
        await tx.notification.create({
          data: {
            employeeId: request.employeeId,
            type: 'OUTSTATION_STATUS',
            message,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'OUTSTATION_STATUS_UPDATED',
          entity: 'BranchChangeRequest',
          entityId: id,
          changes: {
            status: dto.status,
            approvedBy: dto.approvedBy,
          },
        },
      });

      return updated;
    });
  }

  async getDistrictSummary() {
    const requests = await this.prisma.branchChangeRequest.findMany({
      select: { district: true, status: true },
    });

    const summary = new Map<
      string,
      { district: string; total: number; approved: number; pending: number; rejected: number }
    >();

    for (const request of requests) {
      const entry = summary.get(request.district) ?? {
        district: request.district,
        total: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
      };

      entry.total += 1;
      if (request.status === OutstationStatus.APPROVED) {
        entry.approved += 1;
      } else if (request.status === OutstationStatus.PENDING) {
        entry.pending += 1;
      } else if (request.status === OutstationStatus.REJECTED) {
        entry.rejected += 1;
      }

      summary.set(request.district, entry);
    }

    return Array.from(summary.values()).sort((a, b) =>
      a.district.localeCompare(b.district),
    );
  }

  private calculateDuration(startDate: Date, endDate: Date): number {
    const msPerDay = 1000 * 60 * 60 * 24;
    return Math.floor((endDate.getTime() - startDate.getTime()) / msPerDay) + 1;
  }

  private toDateOnly(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }
}
