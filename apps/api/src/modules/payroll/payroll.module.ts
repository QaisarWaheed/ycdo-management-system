import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayChangeRequestsModule } from '../pay-approvals/pay-change-requests.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({
  imports: [AuthModule, PayChangeRequestsModule],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
