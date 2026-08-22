import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PortalPresenceController } from './portal-presence.controller';
import { PortalPresenceService } from './portal-presence.service';

@Module({
  imports: [AuthModule, PermissionsModule],
  controllers: [PortalPresenceController],
  providers: [PortalPresenceService],
})
export class PortalPresenceModule {}
