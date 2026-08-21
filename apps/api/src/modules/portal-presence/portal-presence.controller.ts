import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PortalPresenceQueryDto } from './portal-presence.dto';
import { PortalPresenceService } from './portal-presence.service';

const HR_PORTAL_PRESENCE_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_EXECUTIVE,
  UserRole.HR_OPERATIONS_MANAGER,
];

@Controller('portal-presence')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...HR_PORTAL_PRESENCE_ROLES)
export class PortalPresenceController {
  constructor(private portalPresenceService: PortalPresenceService) {}

  @Get('summary')
  getSummary() {
    return this.portalPresenceService.getSummary();
  }

  @Get()
  findAll(@Query() query: PortalPresenceQueryDto) {
    return this.portalPresenceService.findAll(query);
  }
}
