import api from '../axios'
import type { Letter } from '@/types'

export const lettersApi = {
  getMy: (params?: Record<string, unknown>) =>
    api.get<unknown, Letter[]>('/letters', { params }),
  getPdf: (id: string) =>
    api.get<unknown, Blob>(`/letters/${id}/pdf`, { responseType: 'blob' }),
  markPrinted: (id: string) =>
    api.patch<unknown, Letter>(`/letters/${id}/printed`),
}
