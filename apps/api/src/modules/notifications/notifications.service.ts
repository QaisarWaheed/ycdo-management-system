import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  getMyNotifications(employeeId: string, unreadOnly?: boolean) {
    return this.prisma.notification.findMany({
      where: {
        employeeId,
        ...(unreadOnly ? { isRead: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsRead(notificationId: string, employeeId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException(
        `Notification with id ${notificationId} not found`,
      );
    }

    if (notification.employeeId !== employeeId) {
      throw new ForbiddenException(
        'You can only mark your own notifications as read',
      );
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(employeeId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { employeeId, isRead: false },
      data: { isRead: true },
    });

    return { count: result.count };
  }

  async getUnreadCount(employeeId: string) {
    const count = await this.prisma.notification.count({
      where: { employeeId, isRead: false },
    });

    return { count };
  }

  sendReminder(employeeId: string, message: string) {
    return this.prisma.notification.create({
      data: {
        employeeId,
        message,
        type: 'REMINDER',
      },
    });
  }
}
