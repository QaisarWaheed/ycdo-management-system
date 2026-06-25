import api from '../axios'
import type { Incentive } from '@/types'

export interface CreateIncentivePayload {
  employeeId: string
  amount: number
  reason: string
  month: number
  year: number
}

export const incentivesApi = {
  create: (data: CreateIncentivePayload) =>
    api.post<unknown, Incentive>('/incentives', data),
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, Incentive[]>('/incentives', { params }),
  getByEmployee: (employeeId: string) =>
    api.get<unknown, Incentive[]>(`/incentives/employee/${employeeId}`),
  delete: (id: string) => api.delete(`/incentives/${id}`),
}
