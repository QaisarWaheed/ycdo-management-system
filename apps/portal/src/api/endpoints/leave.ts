import api from '../axios'
import type { LeaveBalance, LeaveRecord } from '@/types'
import type { RelieverCandidate } from '@/components/common/EmployeeSearchSelect'

export interface RequestRelieverPayload {
  leaveRecordId: string
  relieverId: string
}

export interface RespondRelieverPayload {
  accept: boolean
}

export interface IncomingRelieverRequest {
  id: string
  leaveRecordId: string
  requestedAt: string
  status: string
  requestedBy: {
    firstName: string
    lastName: string
    employeeCode: string
  }
  leaveRecord: {
    id: string
    startDate: string
    endDate: string
    totalDays: number
    reason?: string | null
  }
}

export const leaveApi = {
  getMy: (params?: Record<string, unknown>) =>
    api.get<unknown, LeaveRecord[]>('/leave', { params }),
  getMyBalance: (employeeId: string, year?: number) =>
    api.get<unknown, LeaveBalance>(`/leave/balance/${employeeId}`, {
      params: year ? { year } : undefined,
    }),
  apply: (data: Record<string, unknown>) =>
    api.post<unknown, LeaveRecord>('/leave', data),
  cancel: (id: string) => api.delete(`/leave/${id}`),
  getRelieverCandidates: (search?: string) =>
    api.get<unknown, RelieverCandidate[]>('/leave/reliever-candidates', {
      params: search ? { search } : {},
    }),
  requestReliever: (leaveId: string, data: RequestRelieverPayload) =>
    api.post(`/leave/${leaveId}/request-reliever`, data),
  respondToReliever: (requestId: string, data: RespondRelieverPayload) =>
    api.patch(`/leave/reliever/${requestId}/respond`, data),
  getIncomingRelieverRequests: () =>
    api.get<unknown, IncomingRelieverRequest[]>(
      '/leave/incoming-reliever-requests',
    ),
}
