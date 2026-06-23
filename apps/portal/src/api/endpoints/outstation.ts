import api from '../axios'
import type { OutstationRequest } from '@/types'

export const outstationApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, OutstationRequest[]>('/outstation', { params }),
  getOne: (id: string) => api.get<unknown, OutstationRequest>(`/outstation/${id}`),
  create: (data: Record<string, unknown>) =>
    api.post<unknown, OutstationRequest>('/outstation', data),
  updateStatus: (id: string, data: Record<string, unknown>) =>
    api.patch<unknown, OutstationRequest>(`/outstation/${id}/status`, data),
  getDistrictSummary: () => api.get('/outstation/district-summary'),
}
