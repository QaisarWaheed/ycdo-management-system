import api from '../axios'
import type { StipendReceipt } from '@/types'

export interface RespondStipendPayload {
  receiptId: string
  accept: boolean
  rejectionReason?: string
}

export const stipendReceiptsApi = {
  getPending: () =>
    api.get<unknown, StipendReceipt[]>('/stipend-receipts/pending'),
  getMy: () => api.get<unknown, StipendReceipt[]>('/stipend-receipts/my'),
  respond: (data: RespondStipendPayload) =>
    api.patch<unknown, StipendReceipt>('/stipend-receipts/respond', data),
}
