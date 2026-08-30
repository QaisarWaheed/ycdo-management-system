import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

const OPEN_INQUIRY = {
  closedAt: null,
  outcome: null,
} as const;

@Injectable()
export class InquiryDeadlineScheduler {
  private readonly logger = new Logger(InquiryDeadlineScheduler.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 * * * *')
  async checkInquiryDeadlines() {
    this.logger.log('Running inquiry deadline check');
    await this.emitUpcomingReminders();
    await this.emitOverdueAlerts();
  }

  async emitUpcomingReminders(now = new Date()) {
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS);
    const candidates = await this.prisma.inquiry.findMany({
      where: {
        ...OPEN_INQUIRY,
        officiallyOpenedAt: { not: null },
        deadlineReminderSentAt: null,
        deadlineAt: { gt: now, lte: windowEnd },
      },
      include: this.inquiryInclude(),
    });

    for (const inquiry of candidates) {
      try {
        await this.claimAndNotify(inquiry, {
          now,
          kind: 'reminder',
          extraWhere: {
            deadlineReminderSentAt: null,
            deadlineAt: { gt: now, lte: windowEnd },
          },
          marker: { deadlineReminderSentAt: now },
        });
      } catch (err) {
        this.logger.error(
          `Inquiry deadline reminder failed for ${inquiry.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
  }

  async emitOverdueAlerts(now = new Date()) {
    const candidates = await this.prisma.inquiry.findMany({
      where: {
        ...OPEN_INQUIRY,
        officiallyOpenedAt: { not: null },
        overdueNotificationSentAt: null,
        deadlineAt: { lte: now },
      },
      include: this.inquiryInclude(),
    });

    for (const inquiry of candidates) {
      try {
        await this.claimAndNotify(inquiry, {
          now,
          kind: 'overdue',
          extraWhere: {
            overdueNotificationSentAt: null,
            deadlineAt: { lte: now },
          },
          marker: { overdueNotificationSentAt: now },
        });
      } catch (err) {
        this.logger.error(
          `Inquiry overdue alert failed for ${inquiry.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
  }

  private inquiryInclude() {
    return {
      inquiryOfficer: {
        select: {
          id: true,
          email: true,
          employeeId: true,
          employee: { select: { fullName: true } },
        },
      },
      disciplinaryAction: {
        select: {
          id: true,
          employeeId: true,
          employee: { select: { fullName: true } },
        },
      },
    } as const;
  }

  private async claimAndNotify(
    inquiry: {
      id: string;
      deadlineAt: Date;
      inquiryOfficerUserId: string | null;
      inquiryOfficer: {
        id: string;
        email: string;
        employeeId: string | null;
        employee: { fullName: string } | null;
      } | null;
      disciplinaryAction: {
        id: string;
        employeeId: string;
        employee: { fullName: string } | null;
      };
    },
    opts: {
      now: Date;
      kind: 'reminder' | 'overdue';
      extraWhere: Prisma.InquiryWhereInput;
      marker: Prisma.InquiryUpdateManyMutationInput;
    },
  ) {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.inquiry.updateMany({
        where: {
          id: inquiry.id,
          closedAt: null,
          outcome: null,
          ...opts.extraWhere,
        },
        data: opts.marker,
      });
      if (claimed.count !== 1) {
        return;
      }

      const hrManagers = await tx.user.findMany({
        where: { role: UserRole.HR_MANAGER, isActive: true },
        select: { id: true, employeeId: true },
      });

      const employeeName =
        inquiry.disciplinaryAction.employee?.fullName ?? 'employee';
      const officerName =
        inquiry.inquiryOfficer?.employee?.fullName ??
        inquiry.inquiryOfficer?.email ??
        'unassigned';
      const deadlineLabel = this.formatDate(inquiry.deadlineAt);

      const auditActorUserId =
        inquiry.inquiryOfficer?.id ?? hrManagers[0]?.id ?? null;
      if (auditActorUserId) {
        await tx.auditLog.create({
          data: {
            userId: auditActorUserId,
            action:
              opts.kind === 'reminder'
                ? 'INQUIRY_DEADLINE_REMINDER'
                : 'INQUIRY_DEADLINE_OVERDUE',
            entity: 'Inquiry',
            entityId: inquiry.id,
            changes: {
              disciplinaryActionId: inquiry.disciplinaryAction.id,
              employeeId: inquiry.disciplinaryAction.employeeId,
              deadlineAt: inquiry.deadlineAt.toISOString(),
              inquiryOfficerUserId: inquiry.inquiryOfficerUserId,
              kind: opts.kind,
            },
          },
        });
      } else {
        this.logger.warn(
          `Inquiry ${inquiry.id} ${opts.kind} claimed without an audit actor`,
        );
      }

      const message =
        opts.kind === 'reminder'
          ? `Inquiry deadline approaching. Employee: ${employeeName}. Deadline: ${deadlineLabel}. Inquiry officer: ${officerName}.`
          : `Inquiry overdue — HR action required. Employee: ${employeeName}. Deadline: ${deadlineLabel}. Inquiry officer: ${officerName}.`;
      const type =
        opts.kind === 'reminder'
          ? 'INQUIRY_DEADLINE_REMINDER'
          : 'INQUIRY_DEADLINE_OVERDUE';

      const recipientEmployeeIds = new Set<string>();
      if (inquiry.inquiryOfficer?.employeeId) {
        recipientEmployeeIds.add(inquiry.inquiryOfficer.employeeId);
      }
      for (const hr of hrManagers) {
        if (hr.employeeId) {
          recipientEmployeeIds.add(hr.employeeId);
        }
      }

      for (const employeeId of recipientEmployeeIds) {
        await tx.notification.create({
          data: { employeeId, type, message },
        });
      }
    });
  }

  private formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
