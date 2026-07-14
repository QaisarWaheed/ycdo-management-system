import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { ShiftAbsentScheduler } from './shift-absent.scheduler';
import { ShiftCheckoutScheduler } from './shift-checkout.scheduler';

@Module({
  imports: [AuthModule, PermissionsModule],
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    ShiftAbsentScheduler,
    ShiftCheckoutScheduler,
  ],
  exports: [AttendanceService],
})
export class AttendanceModule {}
