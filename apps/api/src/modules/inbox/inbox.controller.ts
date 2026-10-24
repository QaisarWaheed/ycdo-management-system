import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { InboxService, type InboxTab } from './inbox.service';

type JwtUser = { id: string; role: UserRole; roles?: UserRole[] };
const actorOf = (u: JwtUser) => ({ id: u.id, roles: u.roles?.length ? u.roles : [u.role] });
const TABS: InboxTab[] = ['todo', 'sent', 'done'];

/** Every login has an Inbox; what it shows is limited to that login's own work. */
@Controller('inbox')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...(Object.values(UserRole) as UserRole[]))
export class InboxController {
  constructor(private inbox: InboxService) {}

  @Get()
  list(@Query('tab') tab: string = 'todo', @CurrentUser() user: JwtUser) {
    if (!TABS.includes(tab as InboxTab)) throw new BadRequestException('tab must be todo, sent or done');
    return this.inbox.list(actorOf(user), tab as InboxTab);
  }

  @Get('count')
  count(@CurrentUser() user: JwtUser) {
    return this.inbox.todoCount(actorOf(user));
  }
}
