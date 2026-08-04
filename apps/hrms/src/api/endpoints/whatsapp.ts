import api from '../axios'

export type WhatsAppLetterSend = {
  id: string
  letterId: string
  employeeId: string
  phoneE164: string
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED'
  error: string | null
  attempts: number
  metaMessageId: string | null
  lastTriedAt: string | null
  createdAt: string
  employee: {
    id: string
    fullName: string
    employeeCode: string
    phone: string | null
  }
  letter: {
    id: string
    letterType: string
    letterNo: string | null
    fileUrl: string | null
    generatedAt: string
  }
}

export const whatsappApi = {
  getFailedLetterSends: () =>
    api.get<unknown, WhatsAppLetterSend[]>('/whatsapp/letter-sends'),
  resend: (id: string) =>
    api.post<unknown, WhatsAppLetterSend>(`/whatsapp/letter-sends/${id}/resend`),
}
