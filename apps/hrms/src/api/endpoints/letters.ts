import api from '../axios'
import type { Letter, LetterTemplate, LetterWhatsAppShare } from '@/types'

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
    api.get<unknown, LetterTemplate[]>('/letters/templates'),
  preview: (data: Record<string, unknown>) =>
    api.post<unknown, { previewHtml: string; variables: Record<string, unknown> }>(
      '/letters/preview',
      data,
    ),
  generate: (data: Record<string, unknown>) =>
    api.post<unknown, GenerateLetterResponse>('/letters', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<unknown, GenerateLetterResponse>(`/letters/${id}`, data),
  send: (id: string) =>
    api.post<
      unknown,
      { letter: Letter; alreadySent?: boolean; message?: string }
    >(`/letters/${id}/send`),
  reverse: (id: string, reason: string) =>
    api.post<
      unknown,
      {
        letter: Letter
        fineUndone?: boolean
        fineSkippedReason?: string | null
        message?: string
      }
    >(`/letters/${id}/reverse`, { reason }),
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
