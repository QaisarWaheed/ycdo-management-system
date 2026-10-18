import api from '../axios'
import type { StipendReceipt } from '@/types'

export interface RespondStipendPayload {
  receiptId: string
  accept: boolean
  rejectionReason?: string
  /** Req 20.1: correction request. */
  category?: CorrectionCategory
  claimItems?: Array<{ date: string; hours?: number; note?: string }>
}

export type CorrectionCategory = 'OVERTIME' | 'EXTRA_DUTY' | 'DEDUCTION' | 'OTHER'

export interface MySalaryCorrection {
  id: string
  month: number
  year: number
  category: CorrectionCategory
  details: string
  status: 'SUBMITTED' | 'HR_REJECTED' | 'FORWARDED' | 'CHAIRMAN_REJECTED' | 'APPLIED'
  impactAmount: string | number | null
  hrNote: string | null
  decisionNote: string | null
  createdAt: string
}

export const stipendReceiptsApi = {
  getPending: () =>
    api.get<unknown, StipendReceipt[]>('/stipend-receipts/pending'),
  getMy: () => api.get<unknown, StipendReceipt[]>('/stipend-receipts/my'),
  respond: (data: RespondStipendPayload) =>
    api.patch<unknown, StipendReceipt>('/stipend-receipts/respond', data),
  myCorrections: () => api.get<unknown, MySalaryCorrection[]>('/salary-corrections/mine'),
}
