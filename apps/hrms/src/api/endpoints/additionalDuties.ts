import api from '../axios'

/** Extra duty held alongside the employee's own post (e.g. Ward In-charge). */
export type AdditionalDuty = {
  id: string
  employeeId: string
  title: string
  startDate: string
  endDate: string | null
  /** EmployeeAllowance paid for this duty, once added. */
  allowanceId: string | null
  note: string | null
  createdById: string
  createdAt: string
  updatedAt: string
}

export type DutyMissingAllowance = Pick<
  AdditionalDuty,
  'id' | 'title' | 'startDate' | 'endDate' | 'allowanceId'
> & {
  employee: {
    id: string
    fullName: string
    employeeCode: string
    currentDesignation: string | null
    currentBranch: { id: string; name: string } | null
  }
}

export const additionalDutiesApi = {
  list: (employeeId: string) =>
    api.get<unknown, AdditionalDuty[]>('/additional-duties', { params: { employeeId } }),
  create: (data: {
    employeeId: string
    title: string
    startDate: string
    endDate?: string
    note?: string
  }) => api.post<unknown, AdditionalDuty>('/additional-duties', data),
  update: (
    id: string,
    data: { title?: string; startDate?: string; endDate?: string | null; note?: string | null },
  ) => api.patch<unknown, AdditionalDuty>(`/additional-duties/${id}`, data),
  linkAllowance: (id: string, allowanceId: string | null) =>
    api.patch<unknown, AdditionalDuty>(`/additional-duties/${id}/allowance`, { allowanceId }),
  delete: (id: string) => api.delete(`/additional-duties/${id}`),
  missingAllowance: (month: number, year: number) =>
    api.get<unknown, DutyMissingAllowance[]>('/additional-duties/missing-allowance', {
      params: { month, year },
    }),
}
