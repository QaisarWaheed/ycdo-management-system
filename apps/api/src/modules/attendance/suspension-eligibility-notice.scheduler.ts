import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendanceService } from './attendance.service';

@Injectable()
export class SuspensionEligibilityNoticeScheduler {
  private readonly logger = new Logger(
    SuspensionEligibilityNoticeScheduler.name,
  );
  private running = false;

  constructor(private attendanceService: AttendanceService) {}

  @Cron('*/10 * * * *')
  async issueDueNotices() {
    if (this.running) return;
    this.running = true;
    try {
      const eligibility =
        await this.attendanceService.issueDueSuspensionEligibilityNotices();
      const near = await this.attendanceService.issueNearSuspensionWarnings();
      if (eligibility.issued > 0) {
        this.logger.log(
          `Issued ${eligibility.issued} suspension-eligibility notice(s); skipped ${eligibility.skipped}`,
        );
      }
      if (near.issued > 0) {
        this.logger.log(
          `Issued ${near.issued} near-suspension warning(s); skipped ${near.skipped}`,
        );
      }
    } catch (err) {
      this.logger.error(
        'Failed to issue due-for-suspension eligibility notices',
        err instanceof Error ? err.stack : err,
      );
    } finally {
      this.running = false;
    }
  }
}
