import api from '../axios'

export type PayKind = 'INCENTIVE' | 'ALLOWANCE'

export interface BoardRow {
  employeeId: string
  kind: PayKind
  typeId: string
  typeName: string
  previous: number
  current: number
  suggestion: null | {
    id: string
    amount: number
    status: 'PENDING' | 'APPROVED' | 'AMENDED' | 'REJECTED'
    note: string | null
    approvedAmount: number | null
  }
}

export interface Board {
  month: number
  year: number
  incentiveTypes: Array<{ id: string; name: string }>
  allowanceTypes: Array<{ id: string; name: string }>
  employees: Array<{
    id: string
    fullName: string
    employeeCode: string | null
    branch: string | null
    department: string | null
    issues: string[]
  }>
  rows: BoardRow[]
}

/** Phase 2 Req 7 & 8. */
export const incentiveManagementApi = {
  board: (month: number, year: number) =>
    api.get<unknown, Board>('/incentive-management', { params: { month, year } }),
  suggest: (data: {
    employeeId: string
    kind: PayKind
    typeId: string
    month: number
    year: number
    amount: number
    note?: string
  }) => api.post('/incentive-management/suggestions', data),
  apply: (data: {
    month: number
    year: number
    items: Array<{ employeeId: string; kind: PayKind; typeId: string; amount: number }>
  }) =>
    api.post<unknown, { applied: number; failed: Array<{ employeeId: string; typeId: string; reason: string }> }>(
      '/incentive-management/apply',
      data,
    ),
  reject: (suggestionIds: string[], note?: string) =>
    api.post<unknown, { rejected: number }>('/incentive-management/reject', { suggestionIds, note }),
}
