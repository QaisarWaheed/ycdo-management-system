import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LetterRepliesController } from './letter-replies.controller';
import { LetterRepliesService } from './letter-replies.service';

@Module({
  imports: [AuthModule],
  controllers: [LetterRepliesController],
  providers: [LetterRepliesService],
  exports: [LetterRepliesService],
})
export class LetterRepliesModule {}
