import {
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
import { NotificationsService } from './notifications.service';

const ALL_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.BRANCH_HR,
  UserRole.DEPARTMENT_HEAD,
  UserRole.PAYROLL_OFFICER,
  UserRole.EMPLOYEE,
];

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ALL_ROLES)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: { employeeId?: string }) {
    return this.notificationsService.getUnreadCount(user.employeeId!);
  }

  @Patch('read-all')
  markAllAsRead(@CurrentUser() user: { employeeId?: string }) {
    return this.notificationsService.markAllAsRead(user.employeeId!);
  }

  @Get()
  getMyNotifications(
    @CurrentUser() user: { employeeId?: string },
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notificationsService.getMyNotifications(
      user.employeeId!,
      unreadOnly === 'true',
    );
  }

  @Patch(':id/read')
  markAsRead(
    @Param('id') id: string,
    @CurrentUser() user: { employeeId?: string },
  ) {
    return this.notificationsService.markAsRead(id, user.employeeId!);
  }
}
