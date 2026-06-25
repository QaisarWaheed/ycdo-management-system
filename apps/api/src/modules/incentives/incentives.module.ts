import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IncentivesController } from './incentives.controller';
import { IncentivesService } from './incentives.service';

@Module({
  imports: [AuthModule],
  controllers: [IncentivesController],
  providers: [IncentivesService],
  exports: [IncentivesService],
})
export class IncentivesModule {}
