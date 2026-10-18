import api from '../axios'

export type SpecialLeaveType = {
  id: string
  name: string
  payPercent: 0 | 50 | 100
  maxDays: number | null
  isActive: boolean
}

export type SpecialLeave = {
  id: string
  employeeId: string
  startDate: string
  endDate: string
  totalDays: number
  payPercent: number | null
  status: 'HR_PENDING' | 'CHAIRMAN_PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  reason: string | null
  requestedById: string | null
  specialLeaveType: SpecialLeaveType | null
  employee: { fullName: string; employeeCode: string | null; currentBranch: { name: string } | null }
  approvals: Array<{
    stage: string
    action: 'APPROVED' | 'REJECTED'
    notes: string | null
    actionAt: string
    actionByUser: { email: string }
  }>
}

export const SPECIAL_LEAVE_STATUS_LABELS: Record<SpecialLeave['status'], string> = {
  HR_PENDING: 'Waiting for HR Operations',
  CHAIRMAN_PENDING: 'Waiting for Chairman',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

/** Phase 2 Req 2: special leaves — HR Operations → Chairman (final). */
export const specialLeaveApi = {
  types: (all = false) =>
    api.get<unknown, SpecialLeaveType[]>('/special-leave/types', { params: all ? { all: 'true' } : {} }),
  createType: (data: { name: string; payPercent: number; maxDays?: number | null }) =>
    api.post('/special-leave/types', data),
  updateType: (id: string, data: Partial<Omit<SpecialLeaveType, 'id'>>) =>
    api.patch(`/special-leave/types/${id}`, data),
  apply: (data: {
    employeeId: string
    specialLeaveTypeId: string
    startDate: string
    endDate: string
    reason: string
  }) => api.post('/special-leave', data),
  pending: () => api.get<unknown, SpecialLeave[]>('/special-leave/pending'),
  employee: (employeeId: string) =>
    api.get<unknown, SpecialLeave[]>(`/special-leave/employee/${employeeId}`),
  decide: (id: string, approve: boolean, notes?: string) =>
    api.patch(`/special-leave/${id}/decide`, { approve, notes }),
}
