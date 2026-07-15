import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MutualSwapController } from './mutual-swap.controller';
import { MutualSwapService } from './mutual-swap.service';

@Module({
  imports: [AuthModule],
  controllers: [MutualSwapController],
  providers: [MutualSwapService],
  exports: [MutualSwapService],
})
export class MutualSwapModule {}
