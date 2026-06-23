import api from '../axios'
import type { Notification } from '@/types'

export const notificationsApi = {
  getAll: (unreadOnly?: boolean) =>
    api.get<unknown, Notification[]>('/notifications', {
      params: unreadOnly ? { unreadOnly: true } : undefined,
    }),
  getUnreadCount: () =>
    api.get<unknown, { count: number }>('/notifications/unread-count'),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch<unknown, { count: number }>('/notifications/read-all'),
  sendReminder: (data: { employeeId: string; message: string }) =>
    api.post('/notifications/remind', data),
}
