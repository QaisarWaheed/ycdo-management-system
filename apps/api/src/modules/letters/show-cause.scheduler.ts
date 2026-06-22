import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LetterType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ShowCauseScheduler {
  private readonly logger = new Logger(ShowCauseScheduler.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 * * * *')
  async checkShowCauseDeadlines() {
    this.logger.log('Running show cause deadline check');

    const now = new Date();

    const overdueLetters = await this.prisma.letter.findMany({
      where: {
        letterType: LetterType.SHOW_CAUSE,
        isReplied: false,
        autoEscalated: false,
        replyDeadline: { lt: now },
      },
      include: {
        employee: true,
      },
    });

    for (const letter of overdueLetters) {
      await this.prisma.$transaction(async (tx) => {
        await tx.letter.update({
          where: { id: letter.id },
          data: { autoEscalated: true },
        });

        await tx.disciplinaryAction.create({
          data: {
            employeeId: letter.employeeId,
            type: 'SUSPENSION',
            reason: `Auto-escalated: No reply to show cause letter ${letter.fileUrl} within 48 hours`,
            status: 'OPEN',
          },
        });

        await tx.employee.update({
          where: { id: letter.employeeId },
          data: { status: 'SUSPENDED' },
        });

        await tx.user.updateMany({
          where: { employeeId: letter.employeeId },
          data: { isActive: false },
        });

        const hrManagers = await tx.user.findMany({
          where: { role: UserRole.HR_MANAGER, isActive: true },
        });

        for (const hr of hrManagers) {
          if (hr.employeeId) {
            await tx.notification.create({
              data: {
                employeeId: hr.employeeId,
                message: `Show cause auto-escalated for ${letter.employee.firstName} ${letter.employee.lastName}. Employee suspended.`,
                type: 'SHOW_CAUSE_ESCALATED',
              },
            });
          }
        }
      });
    }

    if (overdueLetters.length > 0) {
      this.logger.log(
        `Auto-escalated ${overdueLetters.length} overdue show cause letter(s)`,
      );
    }
  }
}
