import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QualificationsController } from './qualifications.controller';
import { QualificationsService } from './qualifications.service';

@Module({
  imports: [AuthModule],
  controllers: [QualificationsController],
  providers: [QualificationsService],
  exports: [QualificationsService],
})
export class QualificationsModule {}
