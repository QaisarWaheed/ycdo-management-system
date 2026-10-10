import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AllowancesModule } from '../allowances/allowances.module';
import { IncentivesModule } from '../incentives/incentives.module';
import { PayrollModule } from '../payroll/payroll.module';
import { PayApprovalsController } from './pay-approvals.controller';
import { PayApprovalsService } from './pay-approvals.service';
import { PayChangeRequestsModule } from './pay-change-requests.module';

/** Executive approve / reject / IT forward; applies through the owning services. */
@Module({
  imports: [AuthModule, PayChangeRequestsModule, PayrollModule, IncentivesModule, AllowancesModule],
  controllers: [PayApprovalsController],
  providers: [PayApprovalsService],
})
export class PayApprovalsModule {}
