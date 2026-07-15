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

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export const mutualSwapApi = {
  create: (payload: CreateMutualSwapPayload) =>
    api.post<
      unknown,
      { swap: MutualSwapRecord; message: string }
    >('/mutual-swap', payload),

  getEligibleCovering: async (coveredEmployeeId: string, date?: string) => {
    const data = await api.get<unknown, MutualSwapEmployee[]>(
      '/mutual-swap/eligible-covering',
      {
        params: { coveredEmployeeId, date },
      },
    )
    return asArray<MutualSwapEmployee>(data)
  },

  getAll: async (filters?: MutualSwapFilters) => {
    const data = await api.get<unknown, MutualSwapRecord[]>('/mutual-swap', {
      params: filters,
    })
    return asArray<MutualSwapRecord>(data)
  },

  cancel: (id: string) =>
    api.patch<unknown, { message: string }>(`/mutual-swap/${id}/cancel`),
}
