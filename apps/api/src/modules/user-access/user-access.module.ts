import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { UserAccessController } from './user-access.controller';
import { UserAccessService } from './user-access.service';

@Module({
  imports: [PermissionsModule],
  controllers: [UserAccessController],
  providers: [UserAccessService],
  exports: [UserAccessService],
})
export class UserAccessModule {}
