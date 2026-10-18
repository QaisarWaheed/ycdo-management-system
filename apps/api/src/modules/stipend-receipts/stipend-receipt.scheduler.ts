import { previousStipendPeriod } from './stipend-period.util';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { StipendReceiptsService } from './stipend-receipts.service';

@Injectable()
export class StipendReceiptScheduler {
  private readonly logger = new Logger(StipendReceiptScheduler.name);

  constructor(
    private stipendReceiptsService: StipendReceiptsService,
    private payroll: PayrollService,
    private prisma: PrismaService,
  ) {}

  /** Req 20.1: no answer by the 3rd 12:00 PM = accepted automatically. */
  @Cron('*/5 * * * *')
  async autoAcceptExpiredReceipts() {
    const count = await this.stipendReceiptsService.autoAcceptExpiredReceipts();
    if (count > 0) this.logger.log(`Auto-accepted ${count} salary review(s)`);
  }

  /**
   * Req 20.1: on the 1st at 00:05 PKT the system generates last month's payroll
   * for every branch, then opens each employee's salary review (notification).
   */
  @Cron('5 0 1 * *', { timeZone: 'Asia/Karachi' })
  async generateMonthlyPayrollAndReviews() {
    const { month, year } = previousStipendPeriod();
    const system = await this.prisma.user.findFirst({
      where: { role: UserRole.SUPER_ADMIN, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true },
    });
    if (!system) {
      this.logger.error('No active Super Admin to run the monthly payroll as');
      return;
    }
    let offset = 0;
    let generated = 0;
    for (let guard = 0; guard < 200; guard++) {
      const page = await this.payroll.rebuildPayrollFromAttendanceAndLetters(
        { month, year, confirm: 'REBUILD_PAYROLL', limit: 50, offset } as never,
        system,
      );
      generated += page.generated;
      if (!page.hasMore) break;
      offset = page.nextOffset ?? offset + 50;
    }
    const reviews = await this.stipendReceiptsService.generateMonthlyReceipts(month, year);
    this.logger.log(
      `Payroll ${month}/${year}: ${generated} generated; salary reviews ${reviews.generated} opened, ${reviews.skipped} skipped`,
    );
  }
}
