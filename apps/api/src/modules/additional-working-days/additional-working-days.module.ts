import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollModule } from '../payroll/payroll.module';
import { AdditionalWorkingDaysController } from './additional-working-days.controller';
import { AdditionalWorkingDaysService } from './additional-working-days.service';

@Module({
  imports: [AuthModule, PayrollModule],
  controllers: [AdditionalWorkingDaysController],
  providers: [AdditionalWorkingDaysService],
  exports: [AdditionalWorkingDaysService],
})
export class AdditionalWorkingDaysModule {}
