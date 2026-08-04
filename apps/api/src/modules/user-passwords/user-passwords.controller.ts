import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  PortalWhatsAppSharesQueryDto,
  UpdateUserPasswordDto,
  UserPasswordsQueryDto,
} from './user-passwords.dto';
import { UserPasswordsService } from './user-passwords.service';

@Controller('user-passwords')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UserPasswordsController {
  constructor(private userPasswordsService: UserPasswordsService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  findAll(@Query() query: UserPasswordsQueryDto) {
    return this.userPasswordsService.findAll(query);
  }

  /**
   * Super Admin: build WhatsApp Web links with portal email/password
   * for all employee portal accounts (optional project/branch filter).
   */
  @Get('portal-whatsapp-shares')
  @Roles(UserRole.SUPER_ADMIN)
  portalWhatsAppShares(
    @Query() query: PortalWhatsAppSharesQueryDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.userPasswordsService.buildPortalWhatsAppShares(query, user.id);
  }

  @Get(':userId/portal-whatsapp-share')
  @Roles(UserRole.SUPER_ADMIN)
  onePortalWhatsAppShare(
    @Param('userId') userId: string,
    @Query('portalBaseUrl') portalBaseUrl: string | undefined,
    @CurrentUser() user: { id: string },
  ) {
    return this.userPasswordsService.buildOnePortalWhatsAppShare(
      userId,
      portalBaseUrl,
      user.id,
    );
  }

  @Patch(':userId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  update(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserPasswordDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.userPasswordsService.update(userId, dto, user.id);
  }
}
