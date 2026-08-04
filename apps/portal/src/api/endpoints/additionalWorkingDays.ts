import api from '../axios'

export type AdditionalWorkingDay = {
  id: string
  employeeId: string
  date: string
  note: string | null
  addedById: string
  createdAt: string
  updatedAt: string
  addedBy?: { id: string; email: string }
}

export const additionalWorkingDaysApi = {
  getByEmployee: (employeeId: string) =>
    api.get<unknown, AdditionalWorkingDay[]>(
      `/additional-working-days/employee/${employeeId}`,
    ),
}
