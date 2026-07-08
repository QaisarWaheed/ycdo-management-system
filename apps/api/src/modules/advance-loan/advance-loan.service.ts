import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdvanceLoanQueryDto,
  CreateAdvanceLoanDto,
  RejectAdvanceLoanDto,
} from './advance-loan.dto';

@Injectable()
export class AdvanceLoanService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateAdvanceLoanDto, employeeId: string) {
    if (dto.type === 'LOAN' && !dto.repaymentMonths) {
      throw new BadRequestException(
        'Repayment months are required for loan requests',
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { fullName: true },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const request = await this.prisma.advanceLoanRequest.create({
      data: {
        employeeId,
        type: dto.type,
        amount: dto.amount,
        reason: dto.reason,
        repaymentMonths: dto.type === 'LOAN' ? dto.repaymentMonths : null,
      },
      include: {
        employee: { select: { fullName: true, employeeCode: true } },
      },
    });

    const hrUsers = await this.prisma.user.findMany({
      where: {
        role: { in: [UserRole.HR_MANAGER, UserRole.HR_ADMIN_MANAGER] },
        isActive: true,
        employeeId: { not: null },
      },
    });

    const message = `${employee.fullName} has requested a ${dto.type} of PKR ${dto.amount}`;
    for (const hr of hrUsers) {
      if (hr.employeeId) {
        await this.prisma.notification.create({
          data: {
            employeeId: hr.employeeId,
            message,
            type: 'ADVANCE_LOAN_REQUEST',
          },
        });
      }
    }

    return request;
  }

  findAll(query: AdvanceLoanQueryDto) {
    return this.prisma.advanceLoanRequest.findMany({
      where: {
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            currentBranch: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findMy(employeeId: string) {
    return this.prisma.advanceLoanRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByEmployee(employeeId: string) {
    return this.findMy(employeeId);
  }

  async approve(id: string, actingUserId: string) {
    const request = await this.prisma.advanceLoanRequest.findUnique({
      where: { id },
      include: { employee: { select: { fullName: true } } },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Request is not pending');
    }

    const monthlyDeduction =
      request.type === 'LOAN' && request.repaymentMonths
        ? Number(request.amount) / request.repaymentMonths
        : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.advanceLoanRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedBy: actingUserId,
          approvedAt: new Date(),
          monthlyDeduction,
        },
      });

      await tx.notification.create({
        data: {
          employeeId: request.employeeId,
          message: `Your ${request.type.toLowerCase()} request of PKR ${request.amount} has been approved.`,
          type: 'ADVANCE_LOAN_APPROVED',
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'APPROVE_ADVANCE_LOAN',
          entity: 'AdvanceLoanRequest',
          entityId: id,
        },
      });

      return result;
    });

    return updated;
  }

  async reject(id: string, dto: RejectAdvanceLoanDto, actingUserId: string) {
    const request = await this.prisma.advanceLoanRequest.findUnique({
      where: { id },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Request is not pending');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.advanceLoanRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectedBy: actingUserId,
          rejectionReason: dto.rejectionReason,
        },
      });

      await tx.notification.create({
        data: {
          employeeId: request.employeeId,
          message: `Your ${request.type.toLowerCase()} request was rejected: ${dto.rejectionReason}`,
          type: 'ADVANCE_LOAN_REJECTED',
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'REJECT_ADVANCE_LOAN',
          entity: 'AdvanceLoanRequest',
          entityId: id,
        },
      });

      return result;
    });

    return updated;
  }

  async ensureOwnRequest(id: string, employeeId: string) {
    const request = await this.prisma.advanceLoanRequest.findUnique({
      where: { id },
    });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.employeeId !== employeeId) {
      throw new ForbiddenException('Access denied');
    }
    return request;
  }
}
