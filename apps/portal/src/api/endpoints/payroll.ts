import api from '../axios'
import type { PayrollEntry } from '@/types'

export const payrollApi = {
  getMyHistory: (employeeId: string) =>
    api.get<unknown, PayrollEntry[]>(`/payroll/history/${employeeId}`),
  getEntryFull: (id: string) =>
    api.get<unknown, PayrollEntry>(`/payroll/entries/${id}/full`),
}
