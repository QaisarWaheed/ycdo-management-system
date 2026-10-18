import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AllowancesModule } from '../allowances/allowances.module';
import { AdditionalDutiesController } from './additional-duties.controller';
import { AdditionalDutiesService } from './additional-duties.service';

@Module({
  imports: [AuthModule, AllowancesModule],
  controllers: [AdditionalDutiesController],
  providers: [AdditionalDutiesService],
})
export class AdditionalDutiesModule {}
