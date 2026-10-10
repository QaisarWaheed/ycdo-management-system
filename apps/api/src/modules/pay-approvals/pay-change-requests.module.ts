import { Module } from '@nestjs/common';
import { PayChangeRequestsService } from './pay-change-requests.service';

/** Recording / routing requests only (no payroll deps), so Payroll and Incentives can import it. */
@Module({
  providers: [PayChangeRequestsService],
  exports: [PayChangeRequestsService],
})
export class PayChangeRequestsModule {}
