import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PayrollModule } from '../payroll/payroll.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { ShiftAbsentScheduler } from './shift-absent.scheduler';
import { ShiftCheckoutScheduler } from './shift-checkout.scheduler';
import { ShiftMissingCheckoutScheduler } from './shift-missing-checkout.scheduler';
import { ProspectiveShortLeaveScheduler } from './prospective-short-leave.scheduler';

@Module({
  imports: [AuthModule, PermissionsModule, PayrollModule],
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    ShiftAbsentScheduler,
    ShiftCheckoutScheduler,
    ShiftMissingCheckoutScheduler,
    ProspectiveShortLeaveScheduler,
  ],
  exports: [AttendanceService],
})
export class AttendanceModule {}
