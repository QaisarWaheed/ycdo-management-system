import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StipendReceiptsService } from './stipend-receipts.service';

@Injectable()
export class StipendReceiptScheduler {
  private readonly logger = new Logger(StipendReceiptScheduler.name);

  constructor(private stipendReceiptsService: StipendReceiptsService) {}

  @Cron('0 * * * *')
  async autoAcceptExpiredReceipts() {
    const count =
      await this.stipendReceiptsService.autoAcceptExpiredReceipts();
    if (count > 0) {
      this.logger.log(`Auto-accepted ${count} expired stipend receipt(s)`);
    }
  }

  @Cron('0 9 3 * *')
  async generateMonthlyStipendReceipts() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const result = await this.stipendReceiptsService.generateMonthlyReceipts(
      month,
      year,
    );

    this.logger.log(
      `Monthly stipend receipts generated: ${result.generated} created, ${result.skipped} skipped`,
    );
  }
}
