import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdditionalDutiesController } from './additional-duties.controller';
import { AdditionalDutiesService } from './additional-duties.service';

@Module({
  imports: [AuthModule],
  controllers: [AdditionalDutiesController],
  providers: [AdditionalDutiesService],
})
export class AdditionalDutiesModule {}
