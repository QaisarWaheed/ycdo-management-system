import { Module } from '@nestjs/common';
import { PortalPresenceController } from './portal-presence.controller';
import { PortalPresenceService } from './portal-presence.service';

@Module({
  controllers: [PortalPresenceController],
  providers: [PortalPresenceService],
})
export class PortalPresenceModule {}
