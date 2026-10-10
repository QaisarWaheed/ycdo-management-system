import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayChangeRequestsModule } from '../pay-approvals/pay-change-requests.module';
import { IncentivesController } from './incentives.controller';
import { IncentivesService } from './incentives.service';

@Module({
  imports: [AuthModule, PayChangeRequestsModule],
  controllers: [IncentivesController],
  providers: [IncentivesService],
  exports: [IncentivesService],
})
export class IncentivesModule {}
