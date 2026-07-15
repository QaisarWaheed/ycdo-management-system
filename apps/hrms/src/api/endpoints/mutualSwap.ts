import api from '../axios'
import type { Shift } from '@/types'

export interface MutualSwapEmployee {
  id: string
  fullName: string
  employeeCode: string
  dutyStartTime?: string | null
  dutyEndTime?: string | null
  currentDesignation?: string | null
  shift?: Pick<Shift, 'id' | 'name' | 'startTime' | 'endTime'> | null
}

export interface MutualSwapRecord {
  id: string
  date: string
  status: string
  note?: string | null
  coveringEmployeeId: string
  coveredEmployeeId: string
  coveredShiftId: string
  branchId: string
  createdAt: string
  coveringEmployee: MutualSwapEmployee
  coveredEmployee: MutualSwapEmployee
  coveredShift: Shift
  createdBy?: { email: string }
}

export interface CreateMutualSwapPayload {
  coveringEmployeeId: string
  coveredEmployeeId: string
  date: string
  note?: string
}

export interface MutualSwapFilters {
  branchId?: string
  date?: string
  employeeId?: string
}

export const mutualSwapApi = {
  create: (payload: CreateMutualSwapPayload) =>
    api
      .post<{ swap: MutualSwapRecord; message: string }>('/mutual-swap', payload)
      .then((r) => r.data),

  getEligibleCovering: (coveredEmployeeId: string, date?: string) =>
    api
      .get<MutualSwapEmployee[]>('/mutual-swap/eligible-covering', {
        params: { coveredEmployeeId, date },
      })
      .then((r) => r.data),

  getAll: (filters?: MutualSwapFilters) =>
    api
      .get<MutualSwapRecord[]>('/mutual-swap', { params: filters })
      .then((r) => r.data),

  cancel: (id: string) =>
    api.patch<{ message: string }>(`/mutual-swap/${id}/cancel`).then((r) => r.data),
}
