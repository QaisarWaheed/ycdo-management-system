import api from '../axios'

export interface AdvanceLoanRequest {
  id: string
  employeeId: string
  type: string
  amount: number | string
  reason: string
  status: string
  createdAt: string
  employee?: {
    fullName: string
    employeeCode: string
  }
}

export const advanceLoanApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, AdvanceLoanRequest[]>('/advance-loan', { params }),
  approve: (id: string) => api.patch(`/advance-loan/${id}/approve`),
  reject: (id: string, data: { reason: string }) =>
    api.patch(`/advance-loan/${id}/reject`, data),
}
