import api from '../axios'
import type { DisciplinaryAction, Inquiry } from '@/types'

export const disciplinaryApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, DisciplinaryAction[]>('/disciplinary', { params }),
  getOne: (id: string) => api.get(`/disciplinary/${id}`),
  create: (data: Record<string, unknown>) => api.post('/disciplinary', data),
  startInquiry: (data: Record<string, unknown>) =>
    api.post('/disciplinary/inquiry', data),
  resolveInquiry: (data: Record<string, unknown>) =>
    api.patch('/disciplinary/inquiry/resolve', data),
  ensureInquiry: (actionId: string) =>
    api.post<unknown, Inquiry>(`/disciplinary/${actionId}/ensure-inquiry`),
  listEligibleApprovers: () =>
    api.get<
      unknown,
      Array<{
        id: string
        displayName: string
        employeeCode: string | null
        eligibleRole: string
      }>
    >('/disciplinary/suspension/eligible-approvers'),
  listInquiryOfficers: () =>
    api.get<
      unknown,
      Array<{
        id: string
        displayName: string
        employeeCode: string | null
        designation: string | null
        phone: string | null
        role: string
      }>
    >('/disciplinary/suspension/inquiry-officers'),
  prepareSuspension: (actionId: string, data: Record<string, unknown>) =>
    api.post<unknown, { id: string }>(
      `/disciplinary/${actionId}/suspension/prepare`,
      data,
    ),
  getSuspensionRequest: (id: string) =>
    api.get(`/disciplinary/suspension-requests/${id}`),
  updateSuspensionRequest: (id: string, data: Record<string, unknown>) =>
    api.patch(`/disciplinary/suspension-requests/${id}`, data),
  submitSuspensionRequest: (id: string) =>
    api.post(`/disciplinary/suspension-requests/${id}/submit`),
  listMyPendingApprovals: () =>
    api.get<unknown, SuspensionApprovalRequest[]>(
      '/disciplinary/suspension-approvals/my-pending',
    ),
  getAssignedApproval: (id: string) =>
    api.get<unknown, SuspensionApprovalRequest>(
      `/disciplinary/suspension-approvals/${id}`,
    ),
  approveSuspensionRequest: (id: string, note?: string) =>
    api.post(`/disciplinary/suspension-requests/${id}/approve`, { note }),
  rejectSuspensionRequest: (id: string, reason: string) =>
    api.post(`/disciplinary/suspension-requests/${id}/reject`, { reason }),
  getAssignedApprovalLetterPdf: (id: string) =>
    api.get<unknown, Blob>(
      `/disciplinary/suspension-approvals/${id}/letter-pdf`,
      { responseType: 'blob' },
    ),
  recordInquiryFinding: (id: string, data: Record<string, unknown>) =>
    api.post(`/disciplinary/inquiries/${id}/finding`, data),
  submitInquiryFinalDecision: (id: string, data: Record<string, unknown>) =>
    api.post(`/disciplinary/inquiries/${id}/final-decision`, data),
  listMyPendingInquiryDecisions: () =>
    api.get<unknown, InquiryDecisionPending[]>(
      '/disciplinary/inquiry-decisions/my-pending',
    ),
  approveInquiryFinalDecision: (id: string, note?: string) =>
    api.post(`/disciplinary/inquiries/${id}/final-decision/approve`, { note }),
  rejectInquiryFinalDecision: (id: string, reason: string) =>
    api.post(`/disciplinary/inquiries/${id}/final-decision/reject`, { reason }),
  generateMissingFinalLetters: (id: string) =>
    api.post(`/disciplinary/inquiries/${id}/final-letters/generate-missing`),
  closeInquiry: (id: string, data: Record<string, unknown>) =>
    api.post(`/disciplinary/inquiries/${id}/close`, data),
  listMyPendingOpenApprovals: () =>
    api.get<unknown, Inquiry[]>(
      '/disciplinary/inquiry-open-approvals/my-pending',
    ),
  approveInquiryOpen: (id: string, note?: string) =>
    api.post(`/disciplinary/inquiries/${id}/open/approve`, { note }),
  rejectInquiryOpen: (id: string, reason: string) =>
    api.post(`/disciplinary/inquiries/${id}/open/reject`, { reason }),
}

export type SuspensionApprovalRequest = {
  id: string
  status: string
  reason: string
  periodStart: string
  periodEnd: string
  inquiryDeadlineAt: string
  durationDays?: number
  submittedAt?: string | null
  decisionNote?: string | null
  employee?: {
    id: string
    fullName: string
    employeeCode: string
    currentBranch?: { name: string; abbreviation?: string | null } | null
  }
  inquiryOfficer?: {
    email: string
    employee?: { fullName: string } | null
  } | null
  submittedBy?: {
    email: string
    employee?: { fullName: string } | null
  } | null
  letter?: {
    id: string
    status: string
    letterType: string
    letterNo?: string | null
  } | null
  disciplinaryAction?: {
    id: string
    type: string
    status: string
    reason: string
  } | null
}

export type InquiryDecisionPending = Inquiry

