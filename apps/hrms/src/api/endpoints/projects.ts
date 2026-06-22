import api from '../axios'
import type { Project } from '@/types'

export const projectsApi = {
  getAll: () => api.get<unknown, Project[]>('/projects'),
  getOne: (id: string) => api.get<unknown, Project>(`/projects/${id}`),
  create: (data: Record<string, unknown>) =>
    api.post<unknown, Project>('/projects', data),
}
