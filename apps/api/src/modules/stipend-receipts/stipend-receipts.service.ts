import { completedStipendPeriods, isCompletedStipendPeriod } from './stipend-period.util';
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

const PKT_MS = 5 * 3600_000;
/** Req 20.1: 3rd of the next month, 12:00 Pakistan time. */
export function salaryReviewDeadline(month: number, year: number): Date {
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return new Date(Date.UTC(next.y, next.m - 1, 3, 12) - PKT_MS);
}
const deadlineLabel = (d: Date) =>
  `${new Date(d.getTime() + PKT_MS).toISOString().slice(0, 10)} 12:00 PM`;

@Injectable()
export class StipendReceiptsService {
  constructor(private prisma: PrismaService) {}

  async generateMonthlyReceipts(month: number, year: number) {
    if (!isCompletedStipendPeriod(month, year)) throw new BadRequestException('Salary acceptance is for the previous month or earlier, not the current or a future month.');
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

      // Req 20.1: review until the 3rd, 12:00 PKT of the month after the salary month.
      const deadlineAt = salaryReviewDeadline(month, year);
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
            message: `Your salary for ${month}/${year} is ready: PKR ${amount}. Review it in the portal and Accept, or send a correction request, before ${deadlineLabel(deadlineAt)}. Not answered by then = accepted automatically.`,
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
          select: { fullName: true },
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

    if (!isCompletedStipendPeriod(receipt.month, receipt.year)) throw new BadRequestException('This salary month is not yet complete.');

    if (receipt.status !== StipendStatus.PENDING) {
      throw new BadRequestException(
        `Receipt is already ${receipt.status.toLowerCase()}`,
      );
    }

    if (new Date() > receipt.deadlineAt) {
      throw new BadRequestException('Deadline passed');
    }

    if (!dto.accept && !dto.rejectionReason?.trim()) {
      throw new BadRequestException('Write the details of the correction you need');
    }
    if (!dto.accept && (dto.category === 'OVERTIME' || dto.category === 'EXTRA_DUTY') && !dto.claimItems?.length) {
      throw new BadRequestException('Add the dates (and hours for overtime) you are claiming');
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
        // Req 20.1/20.2: the request goes straight to HR Operations' Suggestions tab.
        await tx.salaryCorrectionRequest.create({
          data: {
            employeeId: receipt.employeeId,
            payrollEntryId: receipt.payrollEntryId,
            month: receipt.month,
            year: receipt.year,
            category: dto.category ?? 'OTHER',
            details: dto.rejectionReason!.trim(),
            claimItems: (dto.claimItems ?? undefined) as never,
          },
        });
        const hrUsers = await tx.user.findMany({
          where: {
            isActive: true,
            employeeId: { not: null },
            OR: [
              { role: UserRole.HR_OPERATIONS_MANAGER },
              { additionalRoles: { some: { role: UserRole.HR_OPERATIONS_MANAGER } } },
            ],
          },
        });

        for (const hr of hrUsers) {
          await tx.notification.create({
            data: {
              employeeId: hr.employeeId!,
              type: 'SALARY_SUGGESTION',
              message: `${receipt.employee.fullName} sent a salary correction request for ${receipt.month}/${receipt.year}: ${dto.rejectionReason}`,
            },
          });
        }
      }

      return updated;
    });
  }

  findMyReceipts(employeeId: string) {
    return this.prisma.stipendReceipt.findMany({
      where: { employeeId, ...completedStipendPeriods() },
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
            fullName: true,
            employeeCode: true,
            status: true,
            currentBranch: { select: { name: true, address: true } },
          },
        },
      },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' },
        { employee: { fullName: 'asc' } },
      ],
    });
  }

  getPendingReceipts(employeeId: string) {
    return this.prisma.stipendReceipt.findMany({
      where: {
        employeeId,
        status: StipendStatus.PENDING,
        ...completedStipendPeriods(),
        deadlineAt: { gt: new Date() },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async autoAcceptExpiredReceipts(): Promise<number> {
    const expired = await this.prisma.stipendReceipt.findMany({
      where: {
        status: StipendStatus.PENDING,
        ...completedStipendPeriods(),
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
