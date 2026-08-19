import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollModule } from '../payroll/payroll.module';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { RelieverScheduler } from './reliever.scheduler';

@Module({
  imports: [AuthModule, PayrollModule],
  controllers: [LeaveController],
  providers: [LeaveService, RelieverScheduler],
  exports: [LeaveService],
})
export class LeaveModule {}
