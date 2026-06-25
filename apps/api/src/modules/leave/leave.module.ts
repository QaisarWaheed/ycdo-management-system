import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { RelieverScheduler } from './reliever.scheduler';

@Module({
  imports: [AuthModule],
  controllers: [LeaveController],
  providers: [LeaveService, RelieverScheduler],
  exports: [LeaveService],
})
export class LeaveModule {}
