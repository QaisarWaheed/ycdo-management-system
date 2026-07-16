import api from '../axios'
import type { Employee, WorkingHours } from '@/types'

export const employeesApi = {
  getOne: (id: string) => api.get<unknown, Employee>(`/employees/${id}`),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<unknown, Employee>(`/employees/${id}`, data),
  getDocuments: (id: string) =>
    api.get<unknown, Employee['documents']>(`/employees/${id}/documents`),
  getWorkingHours: (id: string) =>
    api.get<unknown, WorkingHours>(`/employees/${id}/working-hours`),
  uploadPrivatePhoto: (id: string, file: File) => {
    const formData = new FormData()
    formData.append('photo', file)
    return api.post<
      unknown,
      { id: string; hasPrivatePhoto: boolean; privatePhotoUrl: string }
    >(`/employees/${id}/private-photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  setProfilePhotoHidden: (id: string, hide: boolean) =>
    api.patch<unknown, { id: string; hideProfilePhoto: boolean }>(
      `/employees/${id}/hide-photo`,
      { hide },
    ),
}
