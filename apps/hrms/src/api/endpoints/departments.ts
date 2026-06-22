import api from '../axios'
import type { Department } from '@/types'

export const departmentsApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, Department[]>('/departments', { params }),
  getOne: (id: string) => api.get(`/departments/${id}`),
  create: (data: Record<string, unknown>) => api.post('/departments', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/departments/${id}`, data),
}
