import api from '../axios'

export type LoanStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
export type LoanKind = 'LOAN' | 'ADVANCE'
export type LoanPurpose = 'PERSONAL' | 'MEDICAL' | 'MARRIAGE' | 'EDUCATION'
export const LOAN_PURPOSES: LoanPurpose[] = ['PERSONAL', 'MEDICAL', 'MARRIAGE', 'EDUCATION']

export interface EmployeeLoan {
  id: string
  employeeId: string
  amount: number
  monthlyInstallment: number
  startMonth: string
  kind: LoanKind
  purpose: LoanPurpose
  reason: string
  status: LoanStatus
  createdAt: string
  decidedAt: string | null
  decisionNote: string | null
  notificationUrl: string | null
  notificationFileName: string | null
  repaid: number
  remaining: number
}

export interface EmployeeLoans {
  eligibility: { eligible: boolean; serviceMonths: number; minMonths: number }
  loans: EmployeeLoan[]
}

export const loansApi = {
  forEmployee: (employeeId: string) =>
    api.get<unknown, EmployeeLoans>(`/loans/employee/${employeeId}`),
  create: (data: {
    employeeId: string
    amount: number
    monthlyInstallment: number
    startMonth: string
    reason: string
    kind: LoanKind
    purpose: LoanPurpose
  }) => api.post<unknown, EmployeeLoan>('/loans', data),
  /** The signed notification is required to approve. */
  approve: (id: string, file: File, note?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (note) form.append('note', note)
    return api.post(`/loans/${id}/approve`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  amend: (id: string, monthlyInstallment: number, note?: string) =>
    api.post(`/loans/${id}/amend`, { monthlyInstallment, note }),
  reject: (id: string, note?: string) => api.post(`/loans/${id}/reject`, { note }),
  cancel: (id: string, note?: string) => api.post(`/loans/${id}/cancel`, { note }),
  notification: (id: string) =>
    api.get<unknown, Blob>(`/loans/${id}/notification`, { responseType: 'blob' }),
}
