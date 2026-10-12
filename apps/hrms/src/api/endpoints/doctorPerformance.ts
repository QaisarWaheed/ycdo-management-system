import api from '../axios'

export interface PerformanceFigures {
  opdPatients: number
  indoorPatients: number
  surgeries: number
  labTests: number
  /** Lab / diagnostic collection (PKR). */
  labCollection: number
  collection: number
  note?: string | null
}

export interface DoctorPerformanceRow {
  employee: {
    id: string
    fullName: string
    employeeCode: string
    designation: string | null
    status: string
    branch: string | null
    branchId?: string | null
  }
  current: PerformanceFigures | null
  previous: PerformanceFigures | null
  /** Total incentive given last month. */
  previousIncentive?: number
  /** This month's incentives: applied (pending=false) or waiting for approval. */
  incentives: Array<{ name: string; amount: number; pending: boolean }>
}

export interface DoctorPerformanceSheet {
  year: number
  month: number
  previous: { year: number; month: number }
  rows: DoctorPerformanceRow[]
}

export interface ShiftFigures {
  patients: number
  labCollection: number
  collection: number
  note?: string | null
}

export type BranchShift = 'DAY' | 'NIGHT'

export interface BranchPerformanceRow {
  branch: { id: string; name: string }
  shifts: Array<{ shift: BranchShift; current: ShiftFigures | null; previous: ShiftFigures | null }>
  report: { id: string; fileName: string } | null
  adminOfficers: Array<{
    id: string
    fullName: string
    employeeCode: string
    designation: string | null
    incentive: number
    previousIncentive: number
  }>
}

export interface BranchPerformanceSheet {
  year: number
  month: number
  previous: { year: number; month: number }
  rows: BranchPerformanceRow[]
}

export const doctorPerformanceApi = {
  list: (params: { year: number; month: number; branchId?: string }) =>
    api.get<unknown, DoctorPerformanceSheet>('/doctor-performance', { params }),
  save: (data: {
    year: number
    month: number
    rows: Array<PerformanceFigures & { employeeId: string }>
  }) => api.put<unknown, DoctorPerformanceSheet>('/doctor-performance', data),
  branches: (params: { year: number; month: number }) =>
    api.get<unknown, BranchPerformanceSheet>('/doctor-performance/branches', { params }),
  saveBranches: (data: {
    year: number
    month: number
    rows: Array<ShiftFigures & { branchId: string; shift: BranchShift }>
  }) => api.put<unknown, BranchPerformanceSheet>('/doctor-performance/branches', data),
  uploadReport: (branchId: string, params: { year: number; month: number }, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post(`/doctor-performance/branches/${branchId}/report`, form, {
      params,
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  report: (id: string) =>
    api.get<unknown, Blob>(`/doctor-performance/branches/report/${id}`, { responseType: 'blob' }),
}
