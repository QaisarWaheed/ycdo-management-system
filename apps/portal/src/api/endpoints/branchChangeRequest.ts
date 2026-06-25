import api from '../axios'
import type { BranchChangeRequest } from '@/types'

export const branchChangeRequestApi = {
  getMy: (params?: Record<string, unknown>) =>
    api.get<unknown, BranchChangeRequest[]>('/outstation', { params }),
  create: (data: Record<string, unknown>) => api.post('/outstation', data),
}
