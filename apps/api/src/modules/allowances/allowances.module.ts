import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayChangeRequestsModule } from '../pay-approvals/pay-change-requests.module';
import { PayrollModule } from '../payroll/payroll.module';
import { AllowancesController } from './allowances.controller';
import { AllowancesService } from './allowances.service';

@Module({
  imports: [AuthModule, PayrollModule, PayChangeRequestsModule],
  controllers: [AllowancesController],
  providers: [AllowancesService],
  exports: [AllowancesService],
})
export class AllowancesModule {}
