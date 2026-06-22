import api from '../axios'
import type { JobApplication, EmployeePrefill } from '@/types'

export const recruitmentApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, JobApplication[]>('/recruitment', { params }),
  getOne: (id: string) => api.get(`/recruitment/${id}`),
  updateStatus: (id: string, data: Record<string, unknown>) =>
    api.patch(`/recruitment/${id}/status`, data),
  convert: (id: string) =>
    api.post<
      unknown,
      {
        message: string
        employeeData: EmployeePrefill
        application: JobApplication
      }
    >(`/recruitment/${id}/convert`),
  accept: (id: string, data: Record<string, unknown>) =>
    api.post<
      unknown,
      { employee: { id: string; employeeCode: string }; temporaryPassword: string }
    >(`/recruitment/${id}/accept`, data),
}
