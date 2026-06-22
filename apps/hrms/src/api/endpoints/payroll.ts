import api from '../axios'
import type { PayrollEntry, PayrollSummary } from '@/types'

export const payrollApi = {
  getEntries: (params?: Record<string, unknown>) =>
    api.get<unknown, PayrollEntry[]>('/payroll/entries', { params }),
  getEntry: (id: string) =>
    api.get<unknown, PayrollEntry>(`/payroll/entries/${id}`),
  getEntryFull: (id: string) =>
    api.get<
      unknown,
      PayrollEntry & { totalRelieverHours: number; allowances?: unknown[] }
    >(`/payroll/entries/${id}/full`),
  createEntry: (data: Record<string, unknown>) =>
    api.post<unknown, PayrollEntry>('/payroll/entries', data),
  addDeduction: (data: Record<string, unknown>) =>
    api.post<unknown, PayrollEntry>('/payroll/deductions', data),
  addAllowance: (data: Record<string, unknown>) =>
    api.post<unknown, PayrollEntry>('/payroll/allowances', data),
  updateStatus: (id: string, data: Record<string, unknown>) =>
    api.patch<unknown, PayrollEntry>(`/payroll/entries/${id}/status`, data),
  getHistory: (employeeId: string) =>
    api.get<unknown, PayrollEntry[]>(`/payroll/history/${employeeId}`),
  getSummary: (month: number, year: number, branchId?: string) =>
    api.get<unknown, PayrollSummary>('/payroll/summary', {
      params: { month, year, branchId },
    }),
  increment: (data: Record<string, unknown>) =>
    api.post('/payroll/increment', data),
}
