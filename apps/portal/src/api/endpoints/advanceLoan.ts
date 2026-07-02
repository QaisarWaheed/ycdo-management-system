import api from '../axios'
import type { AdvanceLoanRequest } from '@/types'

export interface CreateAdvanceLoanPayload {
  type: 'ADVANCE' | 'LOAN'
  amount: number
  reason: string
  repaymentMonths?: number
}

export const advanceLoanApi = {
  getMy: () => api.get<unknown, AdvanceLoanRequest[]>('/advance-loan/my'),
  create: (data: CreateAdvanceLoanPayload) =>
    api.post<unknown, AdvanceLoanRequest>('/advance-loan', data),
}
