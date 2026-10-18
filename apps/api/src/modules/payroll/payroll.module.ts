import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayChangeRequestsModule } from '../pay-approvals/pay-change-requests.module';
import { EmployeeFinancialService } from './employee-financial.service';
import { PayrollAmendmentController, PayrollAmendmentService } from './payroll-amendment.service';
import { PayrollWorkflowController, PayrollWorkflowService } from './payroll-workflow.service';
import { SalaryCorrectionController, SalaryCorrectionService } from './salary-correction.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { OvertimeReportService } from './overtime-report.service';

@Module({
  imports: [AuthModule, PayChangeRequestsModule],
  controllers: [PayrollController, PayrollAmendmentController, PayrollWorkflowController, SalaryCorrectionController],
  providers: [PayrollService, OvertimeReportService, EmployeeFinancialService, PayrollAmendmentService, PayrollWorkflowService, SalaryCorrectionService],
  exports: [PayrollService],
})
export class PayrollModule {}
