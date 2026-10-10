import api from '../axios'
import type { EmployeeApproverTarget } from './employeeOnboarding'

export type AllowanceProration = 'FULL_MONTH' | 'ATTENDANCE'

export interface PayAllowanceType {
  id: string
  name: string
  proration: AllowanceProration
  legacyField?: string | null
  isActive: boolean
  sortOrder: number
  _count?: { assignments: number }
}

export interface IncentiveType {
  id: string
  name: string
  isActive: boolean
}

export interface EmployeeAllowance {
  id: string
  employeeId: string
  typeId: string
  amount: number | string
  /** ISO date, first day of the first month. */
  startMonth: string
  /** ISO date, first day of the last month; null = until ended. */
  endMonth: string | null
  note?: string | null
  type: PayAllowanceType
}

export type PayChangeKind =
  | 'SALARY_INCREMENT'
  | 'PACKAGE_EDIT'
  | 'ALLOWANCE'
  | 'INCENTIVE'
  | 'PAYROLL_ADDITION'

export type PayChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export interface PayChangeRequest {
  id: string
  kind: PayChangeKind
  employeeId: string
  summary: string
  reason?: string | null
  approverTarget: EmployeeApproverTarget
  status: PayChangeStatus
  reviewNote?: string | null
  reviewedAt?: string | null
  createdAt: string
  employee?: {
    id: string
    fullName: string
    employeeCode: string
    currentDesignation?: string | null
    currentBranch?: { name: string } | null
  }
  submittedBy?: { email: string; employee?: { fullName: string } | null }
  reviewedBy?: { email: string; employee?: { fullName: string } | null } | null
}

/** What the API returns instead of the saved record when a change went for approval. */
export interface PendingApprovalResponse {
  pendingApproval: true
  approverLabel: string
  request: PayChangeRequest
}

export function isPendingApproval(res: unknown): res is PendingApprovalResponse {
  return !!res && typeof res === 'object' && (res as PendingApprovalResponse).pendingApproval === true
}

export const PAY_CHANGE_KIND_LABELS: Record<PayChangeKind, string> = {
  SALARY_INCREMENT: 'Salary increment',
  PACKAGE_EDIT: 'Package change',
  ALLOWANCE: 'Allowance',
  INCENTIVE: 'Incentive / reward',
  PAYROLL_ADDITION: 'Payroll addition',
}

export const allowancesApi = {
  listTypes: () => api.get<unknown, PayAllowanceType[]>('/allowance-types'),
  createType: (data: { name: string; proration: AllowanceProration }) =>
    api.post<unknown, PayAllowanceType>('/allowance-types', data),
  updateType: (
    id: string,
    data: Partial<{ name: string; proration: AllowanceProration; isActive: boolean }>,
  ) => api.patch<unknown, PayAllowanceType>(`/allowance-types/${id}`, data),

  listIncentiveTypes: () => api.get<unknown, IncentiveType[]>('/incentive-types'),
  createIncentiveType: (data: { name: string }) =>
    api.post<unknown, IncentiveType>('/incentive-types', data),
  updateIncentiveType: (id: string, data: Partial<{ name: string; isActive: boolean }>) =>
    api.patch<unknown, IncentiveType>(`/incentive-types/${id}`, data),

  listForEmployee: (employeeId: string) =>
    api.get<unknown, EmployeeAllowance[]>('/employee-allowances', { params: { employeeId } }),
  assign: (data: {
    employeeId: string
    typeId: string
    amount: number
    startMonth: string
    endMonth?: string
    note?: string
    approverTarget?: EmployeeApproverTarget
  }) =>
    api.post<unknown, EmployeeAllowance | PendingApprovalResponse>('/employee-allowances', data),
  end: (id: string, endMonth: string) =>
    api.patch<unknown, { id: string }>(`/employee-allowances/${id}/end`, { endMonth }),
}

export const payApprovalsApi = {
  list: (params: { status?: PayChangeStatus; employeeId?: string } = {}) =>
    api.get<unknown, PayChangeRequest[]>('/pay-approvals', { params }),
  approve: (id: string, reviewNote?: string) =>
    api.post(`/pay-approvals/${id}/approve`, { reviewNote }),
  reject: (id: string, reviewNote: string) =>
    api.post(`/pay-approvals/${id}/reject`, { reviewNote }),
  forward: (id: string, approverTarget: EmployeeApproverTarget, reason: string) =>
    api.post(`/pay-approvals/${id}/forward`, { approverTarget, reason }),
}
