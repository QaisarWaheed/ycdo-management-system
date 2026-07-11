import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FaceSyncController } from './face-sync.controller';
import { FaceSyncService } from './face-sync.service';

@Module({
  imports: [AuthModule],
  controllers: [FaceSyncController],
  providers: [FaceSyncService],
  exports: [FaceSyncService],
})
export class FaceSyncModule {}
