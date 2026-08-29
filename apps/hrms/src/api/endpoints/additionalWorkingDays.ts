import api from '../axios'

export type AdditionalWorkingDay = {
  id: string
  employeeId: string
  date: string
  note: string | null
  addedById: string
  relieverSessionId?: string | null
  createdAt: string
  updatedAt: string
  addedBy?: { id: string; email: string }
}

export const additionalWorkingDaysApi = {
  create: (data: { employeeId: string; date: string; note?: string }) =>
    api.post<unknown, AdditionalWorkingDay>('/additional-working-days', data),
  getByEmployee: (employeeId: string) =>
    api.get<unknown, AdditionalWorkingDay[]>(
      `/additional-working-days/employee/${employeeId}`,
    ),
  delete: (id: string) => api.delete(`/additional-working-days/${id}`),
}
