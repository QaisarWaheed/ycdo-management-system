import api from '../axios'
import type { BranchChangeRequest, DistrictSummary } from '@/types'

// Backend routes remain under /outstation
export const branchChangeRequestApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, BranchChangeRequest[]>('/outstation', { params }),
  getOne: (id: string) =>
    api.get<unknown, BranchChangeRequest>(`/outstation/${id}`),
  create: (data: Record<string, unknown>) =>
    api.post<unknown, BranchChangeRequest>('/outstation', data),
  updateStatus: (id: string, data: Record<string, unknown>) =>
    api.patch<unknown, BranchChangeRequest>(`/outstation/${id}/status`, data),
  getDistrictSummary: () =>
    api.get<unknown, DistrictSummary[]>('/outstation/district-summary'),
}
