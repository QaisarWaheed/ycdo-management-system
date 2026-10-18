import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AllowancesModule } from '../allowances/allowances.module';
import { IncentivesModule } from '../incentives/incentives.module';
import { IncentiveManagementController } from './incentive-management.controller';
import { IncentiveManagementService } from './incentive-management.service';

@Module({
  imports: [AuthModule, IncentivesModule, AllowancesModule],
  controllers: [IncentiveManagementController],
  providers: [IncentiveManagementService],
})
export class IncentiveManagementModule {}
