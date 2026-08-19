import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollModule } from '../payroll/payroll.module';
import { MutualSwapController } from './mutual-swap.controller';
import { MutualSwapService } from './mutual-swap.service';

@Module({
  imports: [AuthModule, PayrollModule],
  controllers: [MutualSwapController],
  providers: [MutualSwapService],
  exports: [MutualSwapService],
})
export class MutualSwapModule {}
