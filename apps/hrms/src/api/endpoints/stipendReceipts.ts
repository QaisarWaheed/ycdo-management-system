import api from '../axios'
import type { StipendReceipt } from '@/types'

export interface GenerateStipendReceiptsPayload {
  month: number
  year: number
}

export interface RespondStipendPayload {
  receiptId: string
  accept: boolean
  rejectionReason?: string
}

export const stipendReceiptsApi = {
  generate: (data: GenerateStipendReceiptsPayload) =>
    api.post<unknown, { generated: number; skipped: number }>(
      '/stipend-receipts/generate',
      data,
    ),
  respond: (data: RespondStipendPayload) =>
    api.patch<unknown, StipendReceipt>('/stipend-receipts/respond', data),
  getMy: () => api.get<unknown, StipendReceipt[]>('/stipend-receipts/my'),
  getPending: () =>
    api.get<unknown, StipendReceipt[]>('/stipend-receipts/pending'),
  getAll: (params?: { month?: number; year?: number }) =>
    api.get<unknown, StipendReceipt[]>('/stipend-receipts', { params }),
}
