import api from '../axios'

export interface Designation {
  id: string
  title: string
  category: string
  isActive: boolean
}

export const designationsApi = {
  getAll: () => api.get<unknown, Designation[]>('/designations'),
  create: (data: { title: string; category: string }) =>
    api.post('/designations', data),
}
