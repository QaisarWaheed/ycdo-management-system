import api from '../axios'
import type { Shift } from '@/types'

export const shiftsApi = {
  getAll: (branchId?: string) =>
    api.get<unknown, Shift[]>('/shifts', {
      params: branchId ? { branchId } : undefined,
    }),
  getByBranch: (branchId: string) =>
    api.get<unknown, Shift[]>(`/shifts/branch/${branchId}`),
  create: (data: Record<string, unknown>) =>
    api.post<unknown, Shift>('/shifts', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<unknown, Shift>(`/shifts/${id}`, data),
}
