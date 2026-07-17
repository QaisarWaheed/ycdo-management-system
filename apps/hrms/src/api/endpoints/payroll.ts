import api from '../axios'
import type { PayrollEntry, PayrollSummary } from '@/types'

export interface CreatePayrollEntryPayload {
  employeeId: string
  month: number
  year: number
  basicStipend?: number
  totalAllowances?: number
}

export interface OvertimePreview {
  employeeId: string
  month: number
  year: number
  basicStipend: number
  dailyHours: number
  daysInMonth: number
  monthlyWorkingHours: number
  overtimeMinutes: number
  pendingOvertimeMinutes?: number
  overtimeHours: number
  hourlyRate: number
  amount: number
  alreadyApplied: boolean
  existingAmount: number | null
  payrollEntryId: string | null
  payrollStatus: string | null
}

export interface StipendIncrementPayload {
  employeeId: string
  basicStipend: number
  allowances?: number
  reward?: number
  progressReward?: number
  fuelAllowance?: number
  loanDeduction?: number
  advanceDeduction?: number
  fineDeduction?: number
  healthDeduction?: number
  effectiveFrom: string
  reason: string
}

type PayrollSummaryResponse = Omit<
  PayrollSummary,
  'totalBasicStipend' | 'totalNetStipend'
> & {
  totalBasicSalary: number
  totalNetSalary: number
}

function mapPayrollSummary(data: PayrollSummaryResponse): PayrollSummary {
  const { totalBasicSalary, totalNetSalary, ...rest } = data
  return {
    ...rest,
    totalBasicStipend: totalBasicSalary,
    totalNetStipend: totalNetSalary,
  }
}

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
  createEntry: (data: CreatePayrollEntryPayload) =>
    api.post<unknown, PayrollEntry>('/payroll/entries', data),
  addDeduction: (data: Record<string, unknown>) =>
    api.post<unknown, PayrollEntry>('/payroll/deductions', data),
  addAllowance: (data: Record<string, unknown>) =>
    api.post<unknown, PayrollEntry>('/payroll/allowances', data),
  updateStatus: (id: string, data: Record<string, unknown>) =>
    api.patch<unknown, PayrollEntry>(`/payroll/entries/${id}/status`, data),
  getHistory: (employeeId: string) =>
    api.get<unknown, PayrollEntry[]>(`/payroll/history/${employeeId}`),
  getSummary: async (month: number, year: number, branchId?: string) => {
    const data = await api.get<unknown, PayrollSummaryResponse>(
      '/payroll/summary',
      {
        params: { month, year, branchId },
      },
    )
    return mapPayrollSummary(data)
  },
  increment: (data: StipendIncrementPayload) =>
    api.post('/payroll/increment', data),

  getOvertimePreview: (employeeId: string, month: number, year: number) =>
    api.get<unknown, OvertimePreview>(
      `/payroll/overtime-preview/${employeeId}`,
      { params: { month, year } },
    ),

  applyOvertime: (data: {
    employeeId: string
    month: number
    year: number
  }) => api.post('/payroll/apply-overtime', data),
}
