import api from '../axios'
import type { Employee } from '@/types'

export interface CreateEmployeePayload extends Record<string, unknown> {
  basicStipend: number
}

export const employeesApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, Employee[]>('/employees', { params }),
  getFilterOptions: () =>
    api.get<unknown, { designations: string[]; districts: string[] }>(
      '/employees/filter-options',
    ),
  getOne: (id: string) => api.get<unknown, Employee>(`/employees/${id}`),
  create: (data: CreateEmployeePayload) =>
    api.post<unknown, Employee>('/employees', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/employees/${id}`, data),
  changeStatus: (id: string, data: Record<string, unknown>) =>
    api.patch(`/employees/${id}/status`, data),
  transfer: (id: string, data: Record<string, unknown>) =>
    api.post(`/employees/${id}/transfer`, data),
  uploadDocument: (id: string, formData: FormData) =>
    api.post(`/employees/${id}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  getDocuments: (id: string) => api.get(`/employees/${id}/documents`),
  deleteDocument: (employeeId: string, documentId: string) =>
    api.delete(`/employees/${employeeId}/documents/${documentId}`),
}
