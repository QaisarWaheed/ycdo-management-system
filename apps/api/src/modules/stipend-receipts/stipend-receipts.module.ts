import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollModule } from '../payroll/payroll.module';
import { StipendReceiptScheduler } from './stipend-receipt.scheduler';
import { StipendReceiptsController } from './stipend-receipts.controller';
import { StipendReceiptsService } from './stipend-receipts.service';

@Module({
  imports: [AuthModule, PayrollModule],
  controllers: [StipendReceiptsController],
  providers: [StipendReceiptsService, StipendReceiptScheduler],
  exports: [StipendReceiptsService],
})
export class StipendReceiptsModule {}
