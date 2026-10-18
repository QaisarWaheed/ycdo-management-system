import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollModule } from '../payroll/payroll.module';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { RelieverScheduler } from './reliever.scheduler';
import { SpecialLeaveController } from './special-leave.controller';
import { SpecialLeaveService } from './special-leave.service';

@Module({
  imports: [AuthModule, PayrollModule],
  controllers: [LeaveController, SpecialLeaveController],
  providers: [LeaveService, SpecialLeaveService, RelieverScheduler],
  exports: [LeaveService],
})
export class LeaveModule {}
