import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  StipendStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RespondStipendDto } from './stipend-receipts.dto';

@Injectable()
export class StipendReceiptsService {
  constructor(private prisma: PrismaService) {}

  async generateMonthlyReceipts(month: number, year: number) {
    const employees = await this.prisma.employee.findMany({
      where: {
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] },
      },
    });

    let generated = 0;
    let skipped = 0;

    for (const employee of employees) {
      const payrollEntry = await this.prisma.payrollEntry.findFirst({
        where: {
          month,
          year,
          stipendRecord: { employeeId: employee.id },
        },
      });

      if (!payrollEntry) {
        skipped += 1;
        continue;
      }

      const existing = await this.prisma.stipendReceipt.findUnique({
        where: { payrollEntryId: payrollEntry.id },
      });

      if (existing) {
        skipped += 1;
        continue;
      }

      const deadlineAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const amount = payrollEntry.netStipend;

      await this.prisma.$transaction(async (tx) => {
        await tx.stipendReceipt.create({
          data: {
            employeeId: employee.id,
            payrollEntryId: payrollEntry.id,
            month,
            year,
            amount,
            status: StipendStatus.PENDING,
            deadlineAt,
          },
        });

        await tx.notification.create({
          data: {
            employeeId: employee.id,
            type: 'STIPEND_RECEIPT',
            message: `Your stipend receipt for ${month}/${year} is ready. Amount: PKR ${amount}. Please accept or reject within 48 hours.`,
          },
        });
      });

      generated += 1;
    }

    return { generated, skipped };
  }

  async respond(dto: RespondStipendDto, employeeId: string) {
    const receipt = await this.prisma.stipendReceipt.findUnique({
      where: { id: dto.receiptId },
      include: {
        employee: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    if (!receipt) {
      throw new NotFoundException(
        `Stipend receipt with id ${dto.receiptId} not found`,
      );
    }

    if (receipt.employeeId !== employeeId) {
      throw new BadRequestException('You can only respond to your own receipts');
    }

    if (receipt.status !== StipendStatus.PENDING) {
      throw new BadRequestException(
        `Receipt is already ${receipt.status.toLowerCase()}`,
      );
    }

    if (new Date() > receipt.deadlineAt) {
      throw new BadRequestException('Deadline passed');
    }

    if (!dto.accept && !dto.rejectionReason?.trim()) {
      throw new BadRequestException('Rejection reason is required');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.stipendReceipt.update({
        where: { id: dto.receiptId },
        data: dto.accept
          ? {
              status: StipendStatus.ACCEPTED,
              acceptedAt: new Date(),
            }
          : {
              status: StipendStatus.REJECTED,
              rejectedAt: new Date(),
              rejectionReason: dto.rejectionReason,
            },
      });

      if (!dto.accept) {
        const hrUsers = await tx.user.findMany({
          where: {
            role: UserRole.HR_MANAGER,
            isActive: true,
            employeeId: { not: null },
          },
        });

        for (const hr of hrUsers) {
          await tx.notification.create({
            data: {
              employeeId: hr.employeeId!,
              type: 'STIPEND_REJECTED',
              message: `${receipt.employee.firstName} ${receipt.employee.lastName} rejected stipend receipt for ${receipt.month}/${receipt.year}. Reason: ${dto.rejectionReason}`,
            },
          });
        }
      }

      return updated;
    });
  }

  findMyReceipts(employeeId: string) {
    return this.prisma.stipendReceipt.findMany({
      where: { employeeId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  findAll(month?: number, year?: number) {
    return this.prisma.stipendReceipt.findMany({
      where: {
        ...(month !== undefined ? { month } : {}),
        ...(year !== undefined ? { year } : {}),
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
            currentBranch: { select: { name: true } },
          },
        },
      },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' },
        { employee: { firstName: 'asc' } },
      ],
    });
  }

  getPendingReceipts(employeeId: string) {
    return this.prisma.stipendReceipt.findMany({
      where: {
        employeeId,
        status: StipendStatus.PENDING,
        deadlineAt: { gt: new Date() },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async autoAcceptExpiredReceipts(): Promise<number> {
    const expired = await this.prisma.stipendReceipt.findMany({
      where: {
        status: StipendStatus.PENDING,
        deadlineAt: { lt: new Date() },
      },
    });

    for (const receipt of expired) {
      await this.prisma.stipendReceipt.update({
        where: { id: receipt.id },
        data: {
          status: StipendStatus.AUTO_ACCEPTED,
          autoAcceptedAt: new Date(),
        },
      });
    }

    return expired.length;
  }
}
