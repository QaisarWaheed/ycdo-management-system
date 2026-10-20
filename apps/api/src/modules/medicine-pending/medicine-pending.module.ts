import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollModule } from '../payroll/payroll.module';
import { MedicinePendingController } from './medicine-pending.controller';
import { MedicinePendingService } from './medicine-pending.service';

@Module({
  imports: [AuthModule, PayrollModule],
  controllers: [MedicinePendingController],
  providers: [MedicinePendingService],
})
export class MedicinePendingModule {}
