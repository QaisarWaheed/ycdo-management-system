import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

@Module({
  imports: [AuthModule],
  controllers: [InboxController],
  providers: [InboxService],
})
export class InboxModule {}
