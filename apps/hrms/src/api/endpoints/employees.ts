import api from '../axios'
import type { Employee } from '@/types'

export interface CreateEmployeePayload extends Record<string, unknown> {
  basicStipend: number
}

export interface WorkingHoursSummary {
  totalMinutes: number
  totalHours: number
  totalDays: number
  thisMonthMinutes: number
  thisMonthHours: number
  averageDailyHours: number
}

export interface EmployeeStats {
  total: number
  byStatus: { status: string; count: number }[]
  byProject: { project: string; projectId: string | null; count: number }[]
  unassigned: number
}

export const employeesApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, Employee[]>('/employees', { params }),
  getStats: () => api.get<unknown, EmployeeStats>('/employees/stats'),
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
  uploadPhoto: (id: string, formData: FormData) =>
    api.post<{ photoUrl: string }>(`/employees/${id}/photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  getDocuments: (id: string) => api.get(`/employees/${id}/documents`),
  deleteDocument: (employeeId: string, documentId: string) =>
    api.delete(`/employees/${employeeId}/documents/${documentId}`),
  getWorkingHours: (id: string) =>
    api.get<unknown, WorkingHoursSummary>(`/employees/${id}/working-hours`),
  updateBranchDuty: (id: string, data: Record<string, unknown>) =>
    api.patch(`/employees/${id}/branch-duty`, data),
  getActiveShift: (params: {
    date: string
    time: string
    branchId?: string
    departmentId?: string
  }) => api.get<unknown, Employee[]>('/employees/active-shift', { params }),
  delete: (id: string) =>
    api.delete<unknown, { success: boolean; message: string }>(
      `/employees/${id}`,
    ),
}
