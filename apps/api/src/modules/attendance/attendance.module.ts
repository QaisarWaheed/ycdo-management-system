import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { ShiftAbsentScheduler } from './shift-absent.scheduler';

@Module({
  imports: [AuthModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, ShiftAbsentScheduler],
  exports: [AttendanceService],
})
export class AttendanceModule {}
