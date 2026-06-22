import api from '../axios'
import type { NotificationBroadcast } from '@/types'

export const broadcastsApi = {
  getAll: () => api.get<unknown, NotificationBroadcast[]>('/broadcasts'),
  create: (data: Record<string, unknown>) =>
    api.post<unknown, NotificationBroadcast & { notificationCount: number }>(
      '/broadcasts',
      data,
    ),
  deactivate: (id: string) => api.delete(`/broadcasts/${id}`),
}
