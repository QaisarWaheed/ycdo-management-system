import { Global, Module } from '@nestjs/common';
import { AccessScopeService } from './access-scope.service';
import { PermissionsService } from './permissions.service';

// Global because RolesGuard and most domain modules depend on these services.
@Global()
@Module({
  providers: [PermissionsService, AccessScopeService],
  exports: [PermissionsService, AccessScopeService],
})
export class PermissionsModule {}
