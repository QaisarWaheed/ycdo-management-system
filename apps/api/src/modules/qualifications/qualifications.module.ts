import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { QualificationsController } from './qualifications.controller';
import { QualificationsService } from './qualifications.service';

@Module({
  imports: [AuthModule, PermissionsModule],
  controllers: [QualificationsController],
  providers: [QualificationsService],
  exports: [QualificationsService],
})
export class QualificationsModule {}
