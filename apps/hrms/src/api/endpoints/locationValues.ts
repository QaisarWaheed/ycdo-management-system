import api from '../axios'

export interface LocationValue {
  id: string
  type: string
  value: string
  province?: string | null
  city?: string | null
}

export const locationValuesApi = {
  getAll: (type: string, search?: string) =>
    api.get<unknown, LocationValue[]>('/location-values', {
      params: { type, search },
    }),
  create: (data: {
    type: string
    value: string
    province?: string
    city?: string
  }) => api.post('/location-values', data),
}
