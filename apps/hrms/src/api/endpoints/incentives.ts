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
  /** Point 21: one-time (default), N months, or permanent. Never shown on the slip. */
  duration?: IncentiveDuration
  /** 2–24, with duration MONTHS. */
  months?: number
}

export type IncentiveDuration = 'ONE_TIME' | 'MONTHS' | 'PERMANENT'

/** Point 21: a recurring incentive; each payroll month gets its own incentive. */
export interface IncentivePlan {
  id: string
  employeeId: string
  amount: string | number
  reason: string
  duration: IncentiveDuration
  startMonth: number
  startYear: number
  endMonth: number | null
  endYear: number | null
  stoppedAt: string | null
  type?: { id: string; name: string } | null
  employee?: { fullName: string; employeeCode: string }
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
  plans: (employeeId?: string) =>
    api.get<unknown, IncentivePlan[]>('/incentives/plans', { params: { employeeId } }),
  /** New amount / last month for the months not yet in payroll. */
  updatePlan: (id: string, data: { amount?: number; endMonth?: number; endYear?: number }) =>
    api.patch<unknown, IncentivePlan>(`/incentives/plans/${id}`, data),
  stopPlan: (id: string, data: { lastMonth: number; lastYear: number }) =>
    api.post<unknown, IncentivePlan>(`/incentives/plans/${id}/stop`, data),
}
