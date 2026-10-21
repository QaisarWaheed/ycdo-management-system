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
  /** Req 5: HR marked that the role carries an allowance (Accounts adds it). */
  allowanceApplicable: boolean
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
    allowanceApplicable?: boolean
  }) => api.post<unknown, AdditionalDuty>('/additional-duties', data),
  update: (
    id: string,
    data: {
      title?: string
      startDate?: string
      endDate?: string | null
      note?: string | null
      allowanceApplicable?: boolean
    },
  ) => api.patch<unknown, AdditionalDuty>(`/additional-duties/${id}`, data),
  linkAllowance: (id: string, allowanceId: string | null) =>
    api.patch<unknown, AdditionalDuty>(`/additional-duties/${id}/allowance`, { allowanceId }),
  delete: (id: string) => api.delete(`/additional-duties/${id}`),
  /** Close the month's check: the allowance does not apply this month (reason required). */
  closeMonth: (id: string, data: { month: number; year: number; reason: string }) =>
    api.post(`/additional-duties/${id}/month-check`, data),
  missingAllowance: (month: number, year: number) =>
    api.get<unknown, DutyMissingAllowance[]>('/additional-duties/missing-allowance', {
      params: { month, year },
    }),
}
