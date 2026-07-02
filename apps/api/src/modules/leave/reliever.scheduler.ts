import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LeaveStatus, RelieverRequestStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RelieverScheduler {
  private readonly logger = new Logger(RelieverScheduler.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 * * * *')
  async autoRejectExpiredRelieverRequests() {
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);

    const expiredRequests = await this.prisma.relieverRequest.findMany({
      where: {
        status: RelieverRequestStatus.PENDING,
        requestedAt: { lt: eightHoursAgo },
        hrAssigned: false,
      },
      include: {
        leaveRecord: {
          include: { employee: true },
        },
        reliever: true,
      },
    });

    for (const request of expiredRequests) {
      await this.prisma.$transaction(async (tx) => {
        await tx.relieverRequest.update({
          where: { id: request.id },
          data: {
            status: RelieverRequestStatus.AUTO_REJECTED,
            autoRejectedAt: new Date(),
          },
        });

        await tx.leaveRecord.update({
          where: { id: request.leaveRecordId },
          data: { status: LeaveStatus.RELIEVER_REJECTED },
        });

        const hrUsers = await tx.user.findMany({
          where: {
            role: { in: [UserRole.HR_MANAGER, UserRole.HR_ADMIN_MANAGER] },
            isActive: true,
            employeeId: { not: null },
          },
        });

        for (const hr of hrUsers) {
          await tx.notification.create({
            data: {
              employeeId: hr.employeeId!,
              message: `Reliever request auto-rejected for ${request.leaveRecord.employee.fullName}. Please assign a reliever manually.`,
              type: 'RELIEVER_AUTO_REJECTED',
            },
          });
        }
      });
    }

    if (expiredRequests.length > 0) {
      this.logger.log(
        `Auto-rejected ${expiredRequests.length} expired reliever request(s)`,
      );
    }
  }
}
