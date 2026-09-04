import api from '../axios'
import type {
  HourlyPayrollBreakdown,
  PayrollEntry,
  PayrollSummary,
} from '@/types'

export interface CreatePayrollEntryPayload {
  employeeId: string
  month: number
  year: number
  basicStipend?: number
  totalAllowances?: number
  allowNonActive?: boolean
  approvalReason?: string
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
      PayrollEntry & {
        totalRelieverHours: number
        allowances?: unknown[]
        hourlyBreakdown?: HourlyPayrollBreakdown
      }
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
  getSummary: async (
    month: number,
    year: number,
    branchId?: string,
    fromDate?: string,
    toDate?: string,
  ) => {
    const data = await api.get<unknown, PayrollSummaryResponse>(
      '/payroll/summary',
      {
        params: { month, year, branchId, fromDate, toDate },
      },
    )
    return mapPayrollSummary(data)
  },
  increment: (data: StipendIncrementPayload) =>
    api.post('/payroll/increment', data),

  updateActiveStipend: (
    data: Omit<StipendIncrementPayload, 'effectiveFrom' | 'reason'> & {
      reason?: string
      /** Correct open package start date without creating a new package. */
      effectiveFrom?: string
    },
  ) => api.patch('/payroll/stipend', data),

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

  downloadReport: (branchId: string, month: number, year: number) =>
    api.get<unknown, Blob>('/payroll/report', {
      params: { branchId, month, year },
      responseType: 'blob',
    }),

  resetUnpaid: (data: {
    month: number
    year: number
    branchId?: string
    allUnpaidMonths?: boolean
    confirm: 'RESET_UNPAID_PAYROLL'
  }) =>
    api.post<
      unknown,
      {
        deleted: number
        paidSkipped: number
        month: number
        year: number
        allUnpaidMonths: boolean
      }
    >('/payroll/reset-unpaid', data),

  rebuildFromAttendance: (data: {
    month: number
    year: number
    branchId?: string
    confirm: 'REBUILD_PAYROLL'
    limit?: number
    offset?: number
  }) =>
    api.post<
      unknown,
      {
        generated: number
        skipped: number
        failed: number
        skippedDetails: Array<{ employeeId: string; reason: string }>
        failures: Array<{ employeeId: string; error: string }>
        totalEmployeesInScope: number
        offset: number
        limit: number
        nextOffset: number
        hasMore: boolean
      }
    >('/payroll/rebuild-from-attendance', data),

  /** Walk every employee batch until the month is fully regenerated. */
  async rebuildMonthBatch(params: {
    month: number
    year: number
    branchId?: string
  }) {
    let offset = 0
    let generated = 0
    let skipped = 0
    let failed = 0
    const failureNotes: string[] = []
    let total = 0
    for (;;) {
      const page = await payrollApi.rebuildFromAttendance({
        month: params.month,
        year: params.year,
        branchId: params.branchId,
        confirm: 'REBUILD_PAYROLL',
        limit: 25,
        offset,
      })
      generated += page.generated
      skipped += page.skipped
      failed += page.failed
      total = page.totalEmployeesInScope
      for (const f of page.failures) {
        failureNotes.push(f.error)
      }
      if (!page.hasMore) {
        return { generated, skipped, failed, total, failureNotes }
      }
      offset = page.nextOffset
    }
  },
}
