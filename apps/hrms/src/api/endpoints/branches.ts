import api from '../axios'
import type { Branch, BranchDetail } from '@/types'

export const branchesApi = {
  getAll: () => api.get<unknown, Branch[]>('/branches'),
  getOne: (id: string) => api.get<unknown, BranchDetail>(`/branches/${id}`),
  getByProject: (projectId: string) =>
    api.get<unknown, Branch[]>(`/branches/project/${projectId}`),
  create: (data: Record<string, unknown>) => api.post('/branches', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/branches/${id}`, data),
}
