import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LettersController } from './letters.controller';
import { LettersService } from './letters.service';
import { ShowCauseScheduler } from './show-cause.scheduler';

@Module({
  imports: [AuthModule],
  controllers: [LettersController],
  providers: [LettersService, ShowCauseScheduler],
  exports: [LettersService],
})
export class LettersModule {}