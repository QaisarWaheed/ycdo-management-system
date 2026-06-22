import api from '../axios'
import type { DisciplinaryAction } from '@/types'

export const disciplinaryApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, DisciplinaryAction[]>('/disciplinary', { params }),
  getOne: (id: string) => api.get(`/disciplinary/${id}`),
  create: (data: Record<string, unknown>) => api.post('/disciplinary', data),
  startInquiry: (data: Record<string, unknown>) =>
    api.post('/disciplinary/inquiry', data),
  resolveInquiry: (data: Record<string, unknown>) =>
    api.patch('/disciplinary/inquiry/resolve', data),
}
