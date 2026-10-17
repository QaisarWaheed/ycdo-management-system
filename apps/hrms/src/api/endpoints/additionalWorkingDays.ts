import api from '../axios'

/** Point 20: HR enters, HR Operations approves; a rejection goes to the Chairman. */
export type ExtraTimeStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ESCALATED'

export const EXTRA_TIME_STATUS_LABELS: Record<ExtraTimeStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ESCALATED: 'With Chairman',
}

export type ExtraTimeKind = 'day' | 'overtime'

export type PendingExtraTime = {
  kind: ExtraTimeKind
  id: string
  employeeName: string
  employeeCode: string
  branch: string | null
  date: string
  minutes: number | null
  note: string | null
  status: ExtraTimeStatus
  reviewNote: string | null
  requestedById: string | null
  requestedBy: string | null
}

export type AdditionalWorkingDay = {
  id: string
  employeeId: string
  date: string
  note: string | null
  addedById: string
  relieverSessionId?: string | null
  status: ExtraTimeStatus
  reviewNote?: string | null
  createdAt: string
  updatedAt: string
  addedBy?: { id: string; email: string }
}

export const additionalWorkingDaysApi = {
  create: (data: { employeeId: string; date: string; note?: string }) =>
    api.post<unknown, AdditionalWorkingDay>('/additional-working-days', data),
  getByEmployee: (employeeId: string) =>
    api.get<unknown, AdditionalWorkingDay[]>(
      `/additional-working-days/employee/${employeeId}`,
    ),
  delete: (id: string) => api.delete(`/additional-working-days/${id}`),
}

export const extraTimeApi = {
  pending: () => api.get<unknown, PendingExtraTime[]>('/extra-time/pending'),
  approve: (kind: ExtraTimeKind, id: string, note?: string) =>
    api.post(`/extra-time/${kind}/${id}/approve`, { note }),
  reject: (kind: ExtraTimeKind, id: string, note?: string) =>
    api.post(`/extra-time/${kind}/${id}/reject`, { note }),
}
