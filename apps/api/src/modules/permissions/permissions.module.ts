import { Global, Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';

// Global because RolesGuard (used in most modules) depends on PermissionsService.
@Global()
@Module({
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
