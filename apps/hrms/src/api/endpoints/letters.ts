import api from '../axios'
import type { Letter, LetterWhatsAppShare } from '@/types'

interface GenerateLetterResponse {
  letter: Letter
  previewHtml: string
}

export const lettersApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, Letter[]>('/letters', { params }),
  getPending: () => api.get<unknown, Letter[]>('/letters/pending'),
  getOne: (id: string) => api.get<unknown, Letter>(`/letters/${id}`),
  getTemplates: () =>
    api.get<
      unknown,
      { id: string; code: string; name: string; requiredVars: string[]; version: number }[]
    >('/letters/templates'),
  preview: (data: Record<string, unknown>) =>
    api.post<unknown, { previewHtml: string; variables: Record<string, unknown> }>(
      '/letters/preview',
      data,
    ),
  generate: (data: Record<string, unknown>) =>
    api.post<unknown, GenerateLetterResponse>('/letters', data),
  getPdf: (id: string) =>
    api.get<unknown, Blob>(`/letters/${id}/pdf`, { responseType: 'blob' }),
  getWhatsAppShare: (id: string) =>
    api.get<unknown, LetterWhatsAppShare>(`/letters/${id}/whatsapp-share`),
  markWhatsAppShared: (id: string) =>
    api.post<unknown, Letter>(`/letters/${id}/mark-whatsapp-shared`),
  markPrinted: (id: string) =>
    api.patch<unknown, Letter>(`/letters/${id}/printed`),
  delete: (id: string) => api.delete(`/letters/${id}`),
}
