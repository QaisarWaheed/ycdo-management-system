import api from '../axios'

export interface FinancialMonth {
  month: number
  year: number
  status: string
  basic: number
  allowances: number
  incentives: number
  overtime: number
  extraDuty: number
  fines: number
  otherDeductions: number
  net: number
  letters: number
}

export interface FinancialHistoryRow {
  at: string
  by: string | null
  area: string
  entityId: string
  action: string
  before: unknown
  after: unknown
  reason: string | null
  details: Record<string, unknown> | null
}

export interface EmployeeFinancial {
  totals: {
    fines: number
    otherDeductions: number
    incentives: number
    allowances: number
    overtime: number
    extraDuty: number
    net: number
  }
  months: FinancialMonth[]
  deductions: Array<{
    month: number
    year: number
    reason: string
    fineReason: string | null
    description: string | null
    amount: number
  }>
  payments: Array<{ month: number; year: number; type: string; description: string | null; amount: number }>
  history: FinancialHistoryRow[]
}

/** Phase 2 Req 1: an employee's money picture and full change trail. */
export const employeeFinancialApi = {
  get: (employeeId: string) =>
    api.get<unknown, EmployeeFinancial>(`/payroll/employee/${employeeId}/financial`),
}
