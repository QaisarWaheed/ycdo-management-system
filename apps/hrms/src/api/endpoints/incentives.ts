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
  stats: (params: { year: number; month: number }) =>
    api.get<
      unknown,
      {
        monthly: Array<{ year: number; month: number; total: number }>
        byBranch: Array<{ branch: string; total: number }>
      }
    >('/incentives/stats', { params }),
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, Incentive[]>('/incentives', { params }),
  getByEmployee: (employeeId: string) =>
    api.get<unknown, Incentive[]>(`/incentives/employee/${employeeId}`),
  /** Lowering / retyping applies at once; a higher amount from Finance goes for approval. */
  update: (id: string, data: Omit<CreateIncentivePayload, 'employeeId'>) =>
    api.patch<unknown, Incentive | PendingApprovalResponse>(`/incentives/${id}`, data),
  delete: (id: string) => api.delete(`/incentives/${id}`),
}
