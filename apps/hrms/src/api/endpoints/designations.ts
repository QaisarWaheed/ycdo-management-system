import api from '../axios'

export interface Designation {
  id: string
  title: string
  category: string
  isActive: boolean
  employees?: number
}

export interface DesignationQueryParams {
  category?: string
  categories?: string
}

export const designationsApi = {
  getAll: (params?: DesignationQueryParams) =>
    api.get<unknown, Designation[]>('/designations', { params }),
  create: (data: { title: string; category: string }) =>
    api.post('/designations', data),
  update: (id: string, data: { title?: string; category?: string }) =>
    api.patch(`/designations/${id}`, data),
  deactivate: (id: string) => api.delete(`/designations/${id}`),
}
