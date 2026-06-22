import api from '../axios'
import type { Employee } from '@/types'

export const employeesApi = {
  getOne: (id: string) => api.get<unknown, Employee>(`/employees/${id}`),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<unknown, Employee>(`/employees/${id}`, data),
  getDocuments: (id: string) =>
    api.get<unknown, Employee['documents']>(`/employees/${id}/documents`),
}
