import api from '../axios'
import type { Employee, LeaveBalance, LeaveRecord } from '@/types'

export interface TodayRelieverRow {
  employee: {
    name: string
    code: string
    branch: string | null
    department: string | null
  }
  reliever: {
    name: string
    code: string
    branch: string | null
    department: string | null
  } | null
  leaveStartDate: string
  leaveEndDate: string
  relieverRequestStatus: string | null
}

export interface RequestRelieverPayload {
  leaveRecordId: string
  relieverId: string
}

export interface RespondRelieverPayload {
  accept: boolean
}

export interface HRAssignRelieverPayload {
  relieverId: string
}

export interface ApproveLeavePayload {
  action: 'APPROVED' | 'REJECTED'
  notes?: string
}

export const leaveApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, LeaveRecord[]>('/leave', { params }),
  getOne: (id: string) => api.get(`/leave/${id}`),
  getApprovals: (id: string) =>
    api.get<unknown, LeaveRecord>(`/leave/${id}/approvals`),
  apply: (data: Record<string, unknown>) =>
    api.post<unknown, LeaveRecord>('/leave', data),
  branchApprove: (id: string, data: ApproveLeavePayload) =>
    api.patch(`/leave/${id}/branch-approve`, data),
  deptApprove: (id: string, data: ApproveLeavePayload) =>
    api.patch(`/leave/${id}/dept-approve`, data),
  hrApprove: (id: string, data: ApproveLeavePayload) =>
    api.patch(`/leave/${id}/hr-approve`, data),
  updateStatus: (id: string, data: Record<string, unknown>) =>
    api.patch(`/leave/${id}/status`, data),
  getBalance: (employeeId: string, year?: number) =>
    api.get<unknown, LeaveBalance>(`/leave/balance/${employeeId}`, {
      params: { year },
    }),
  cancel: (id: string) => api.delete(`/leave/${id}`),
  getTodayRelievers: () =>
    api.get<unknown, TodayRelieverRow[]>('/leave/today-relievers'),
  getRelieverCandidates: (search?: string) =>
    api.get<unknown, Employee[]>('/leave/reliever-candidates', {
      params: search ? { search } : {},
    }),
  requestReliever: (leaveId: string, data: RequestRelieverPayload) =>
    api.post(`/leave/${leaveId}/request-reliever`, data),
  respondToReliever: (requestId: string, data: RespondRelieverPayload) =>
    api.patch(`/leave/reliever/${requestId}/respond`, data),
  hrAssignReliever: (leaveId: string, data: HRAssignRelieverPayload) =>
    api.post(`/leave/${leaveId}/hr-assign-reliever`, data),
}
