import api from '../axios'
import type { LeaveBalance, LeaveRecord } from '@/types'

export const leaveApi = {
  getMy: (params?: Record<string, unknown>) =>
    api.get<unknown, LeaveRecord[]>('/leave', { params }),
  getMyBalance: (employeeId: string, year?: number) =>
    api.get<unknown, LeaveBalance>(`/leave/balance/${employeeId}`, {
      params: year ? { year } : undefined,
    }),
  apply: (data: Record<string, unknown>) => api.post('/leave', data),
  cancel: (id: string) => api.delete(`/leave/${id}`),
}
