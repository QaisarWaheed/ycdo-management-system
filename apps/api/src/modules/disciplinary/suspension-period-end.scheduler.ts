import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  EmployeeStatus,
  SuspensionRequestStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toPakistanDateOnly } from '../attendance/attendance-late.util';

const HR_ALERT_ROLES: UserRole[] = [
  UserRole.HR_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
];

/**
 * Point 25: once an issued suspension's period has ended and the employee is
 * still suspended, HR is told once to reinstate or extend. Pay is not touched:
 * suspension days stay unpaid unless HR adds them.
 */
@Injectable()
export class SuspensionPeriodEndScheduler {
  private readonly logger = new Logger(SuspensionPeriodEndScheduler.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 9 * * *', { timeZone: 'Asia/Karachi' })
  async run() {
    await this.alertEndedSuspensions();
  }

  async alertEndedSuspensions(now = new Date()) {
    const due = await this.prisma.suspensionRequest.findMany({
      where: {
        status: SuspensionRequestStatus.ISSUED,
        periodEndAlertedAt: null,
        periodEnd: { lt: toPakistanDateOnly(now) },
        employee: { status: EmployeeStatus.SUSPENDED },
      },
      include: { employee: { select: { fullName: true, employeeCode: true } } },
    });
    let alerted = 0;
    for (const request of due) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.suspensionRequest.updateMany({
            where: { id: request.id, periodEndAlertedAt: null },
            data: { periodEndAlertedAt: now },
          });
          if (claimed.count !== 1) return;
          const hr = await tx.user.findMany({
            where: {
              role: { in: HR_ALERT_ROLES },
              isActive: true,
              employeeId: { not: null },
            },
            select: { employeeId: true },
          });
          const message = `Suspension period ended for ${request.employee.fullName} (${request.employee.employeeCode}) on ${toPakistanDateOnly(request.periodEnd).toISOString().slice(0, 10)}: reinstate or extend`;
          for (const employeeId of new Set(hr.map((u) => u.employeeId!))) {
            await tx.notification.create({
              data: { employeeId, type: 'SUSPENSION_PERIOD_ENDED', message },
            });
          }
          alerted++;
        });
      } catch (err) {
        this.logger.error(
          `Suspension period-end alert failed for ${request.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
    return { alerted };
  }
}
