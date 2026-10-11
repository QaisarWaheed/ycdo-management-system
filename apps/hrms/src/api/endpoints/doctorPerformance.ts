import api from '../axios'

export interface PerformanceFigures {
  opdPatients: number
  indoorPatients: number
  surgeries: number
  labTests: number
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
  }
  current: PerformanceFigures | null
  previous: PerformanceFigures | null
  /** This month's incentives: applied (pending=false) or waiting for approval. */
  incentives: Array<{ name: string; amount: number; pending: boolean }>
}

export interface DoctorPerformanceSheet {
  year: number
  month: number
  previous: { year: number; month: number }
  rows: DoctorPerformanceRow[]
}

export const doctorPerformanceApi = {
  list: (params: { year: number; month: number; branchId?: string }) =>
    api.get<unknown, DoctorPerformanceSheet>('/doctor-performance', { params }),
  save: (data: {
    year: number
    month: number
    rows: Array<PerformanceFigures & { employeeId: string }>
  }) => api.put<unknown, DoctorPerformanceSheet>('/doctor-performance', data),
}
