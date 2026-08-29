import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PayrollModule } from '../payroll/payroll.module';
import { LettersModule } from '../letters/letters.module';
import { DisciplinaryModule } from '../disciplinary/disciplinary.module';
import { AdditionalWorkingDaysModule } from '../additional-working-days/additional-working-days.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { ShiftAbsentScheduler } from './shift-absent.scheduler';
import { ShiftCheckoutScheduler } from './shift-checkout.scheduler';
import { ShiftMissingCheckoutScheduler } from './shift-missing-checkout.scheduler';
import { ProspectiveShortLeaveScheduler } from './prospective-short-leave.scheduler';
import { SuspensionEligibilityNoticeScheduler } from './suspension-eligibility-notice.scheduler';

@Module({
  imports: [
    AuthModule,
    PermissionsModule,
    PayrollModule,
    LettersModule,
    DisciplinaryModule,
    AdditionalWorkingDaysModule,
  ],
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    ShiftAbsentScheduler,
    ShiftCheckoutScheduler,
    ShiftMissingCheckoutScheduler,
    ProspectiveShortLeaveScheduler,
    SuspensionEligibilityNoticeScheduler,
  ],
  exports: [AttendanceService],
})
export class AttendanceModule {}
