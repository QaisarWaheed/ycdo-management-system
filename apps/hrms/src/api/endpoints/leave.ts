import api from '../axios'
import type { LeaveBalance, LeaveRecord } from '@/types'

export const leaveApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, LeaveRecord[]>('/leave', { params }),
  getOne: (id: string) => api.get(`/leave/${id}`),
  apply: (data: Record<string, unknown>) => api.post('/leave', data),
  updateStatus: (id: string, data: Record<string, unknown>) =>
    api.patch(`/leave/${id}/status`, data),
  getBalance: (employeeId: string, year?: number) =>
    api.get<unknown, LeaveBalance>(`/leave/balance/${employeeId}`, {
      params: { year },
    }),
  cancel: (id: string) => api.delete(`/leave/${id}`),
}
