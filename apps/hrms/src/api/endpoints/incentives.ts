import type { PendingApprovalResponse } from './payApprovals'
import type { EmployeeApproverTarget } from './employeeOnboarding'
import api from '../axios'
import type { Incentive } from '@/types'

export interface CreateIncentivePayload {
  employeeId: string
  amount: number
  typeId?: string
  reason?: string
  month: number
  year: number
  approverTarget?: EmployeeApproverTarget
}

export const incentivesApi = {
  create: (data: CreateIncentivePayload) =>
    api.post<unknown, Incentive | PendingApprovalResponse>('/incentives', data),
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, Incentive[]>('/incentives', { params }),
  getByEmployee: (employeeId: string) =>
    api.get<unknown, Incentive[]>(`/incentives/employee/${employeeId}`),
  delete: (id: string) => api.delete(`/incentives/${id}`),
}
