import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayChangeRequestsModule } from '../pay-approvals/pay-change-requests.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { OvertimeReportService } from './overtime-report.service';

@Module({
  imports: [AuthModule, PayChangeRequestsModule],
  controllers: [PayrollController],
  providers: [PayrollService, OvertimeReportService],
  exports: [PayrollService],
})
export class PayrollModule {}
