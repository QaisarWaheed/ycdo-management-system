import api from '../axios'
import type { Letter } from '@/types'

interface GenerateLetterResponse {
  letter: Letter
  previewHtml: string
}

export const lettersApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, Letter[]>('/letters', { params }),
  getOne: (id: string) => api.get<unknown, Letter>(`/letters/${id}`),
  generate: (data: Record<string, unknown>) =>
    api.post<unknown, GenerateLetterResponse>('/letters', data),
  getPdf: (id: string) =>
    api.get<unknown, Blob>(`/letters/${id}/pdf`, { responseType: 'blob' }),
  markPrinted: (id: string) =>
    api.patch<unknown, Letter>(`/letters/${id}/printed`),
  delete: (id: string) => api.delete(`/letters/${id}`),
}
