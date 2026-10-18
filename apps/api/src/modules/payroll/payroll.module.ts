import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayChangeRequestsModule } from '../pay-approvals/pay-change-requests.module';
import { EmployeeFinancialService } from './employee-financial.service';
import { PayrollAmendmentController, PayrollAmendmentService } from './payroll-amendment.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { OvertimeReportService } from './overtime-report.service';

@Module({
  imports: [AuthModule, PayChangeRequestsModule],
  controllers: [PayrollController, PayrollAmendmentController],
  providers: [PayrollService, OvertimeReportService, EmployeeFinancialService, PayrollAmendmentService],
  exports: [PayrollService],
})
export class PayrollModule {}
