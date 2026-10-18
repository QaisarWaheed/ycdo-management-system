import { useQuery } from '@tanstack/react-query'
import api from '../axios'

export type PayrollActivity =
  | 'EMPLOYEE_SALARY_REVIEW'
  | 'HR_SALARY_CORRECTIONS'
  | 'DEPT_INCHARGE_SUGGESTIONS'
  | 'FINANCE_VERIFICATION'
  | 'PC_PROOF_READING'

export interface ActivityWindow {
  activity: PayrollActivity
  label: string
  open: boolean
  exempt: boolean
  opensAt: string
  closesAt: string
  payrollMonth: number
  payrollYear: number
  extensionUntil: string | null
}

export interface CorrectionLine {
  kind: 'OVERTIME' | 'EXTRA_DUTY' | 'ADD' | 'DEDUCT'
  hours?: number
  days?: number
  amount?: number
  note?: string
}

export interface SalaryCorrection {
  id: string
  month: number
  year: number
  category: string
  details: string
  claimItems: Array<{ date: string; hours?: number; note?: string }> | null
  status: 'SUBMITTED' | 'HR_REJECTED' | 'FORWARDED' | 'CHAIRMAN_REJECTED' | 'APPLIED'
  hrLines: Array<CorrectionLine & { amount: number; signed: number }> | null
  hrNote: string | null
  impactAmount: string | number | null
  decisionNote: string | null
  createdAt: string
  employee: {
    id: string
    fullName: string
    employeeCode: string | null
    currentBranch: { name: string } | null
    currentDepartment: { name: string } | null
  }
}

export interface WorkflowEntry {
  id: string
  status: string
  basicStipend: string | number
  totalAllowances: string | number
  totalDeductions: string | number
  netStipend: string | number
  stipendRecord: {
    employee: {
      id: string
      fullName: string
      employeeCode: string | null
      currentDesignation: string | null
      currentBranch: { name: string } | null
      currentDepartment: { name: string } | null
    }
  }
  reviewIssues: Array<{ id: string; kind: string; status: string; note: string; response: string | null }>
}

export interface ReviewIssue {
  id: string
  kind: 'FINANCE_CORRECTION' | 'PC_PROOF_READING'
  status: 'OPEN' | 'RESPONDED' | 'CLOSED'
  note: string
  response: string | null
  lineKind: string | null
  lineId: string | null
  createdAt: string
  payrollEntry: {
    id: string
    month: number
    year: number
    status: string
    netStipend: string | number
    stipendRecord: { employee: { id: string; fullName: string; employeeCode: string | null } }
  }
}

type Result = { done: number; failed: Array<{ entryId?: string; id?: string; error: string }> }

/** Req 20: monthly payroll workflow and activity time windows. */
export const payrollMonthlyApi = {
  myWindows: () => api.get<unknown, ActivityWindow[]>('/activity-windows/me'),
  extensions: () =>
    api.get<
      unknown,
      Array<{
        id: string
        activity: PayrollActivity
        startsAt: string
        endsAt: string
        reason: string
        revokedAt: string | null
        user: { email: string; role: string; employee: { fullName: string } | null }
      }>
    >('/activity-windows/extensions'),
  grantExtension: (data: { userId: string; activity: PayrollActivity; startsAt: string; endsAt: string; reason: string }) =>
    api.post('/activity-windows/extensions', data),
  revokeExtension: (id: string) => api.post(`/activity-windows/extensions/${id}/revoke`),

  corrections: (params: { status?: string; month?: number; year?: number }) =>
    api.get<unknown, SalaryCorrection[]>('/salary-corrections', { params }),
  correctionRate: (id: string) =>
    api.get<unknown, { basic: number; daysInMonth: number; dailyHours: number }>(`/salary-corrections/${id}/rate`),
  hrDecide: (id: string, data: { accept: boolean; lines?: CorrectionLine[]; note?: string }) =>
    api.post(`/salary-corrections/${id}/hr`, data),
  chairmanDecide: (ids: string[], approve: boolean, note?: string) =>
    api.post<unknown, { done: number; failed: Array<{ id: string; error: string }> }>('/salary-corrections/chairman', {
      ids,
      approve,
      note,
    }),

  entries: (params: { month: number; year: number; status?: string }) =>
    api.get<unknown, WorkflowEntry[]>('/payroll-workflow/entries', { params }),
  founderApprove: (entryIds: string[]) => api.post<unknown, Result>('/payroll-workflow/founder-approve', { entryIds }),
  pcVerify: (entryIds: string[]) => api.post<unknown, Result>('/payroll-workflow/pc-verify', { entryIds }),
  raiseIssue: (data: {
    entryId: string
    kind: 'FINANCE_CORRECTION' | 'PC_PROOF_READING'
    note: string
    assignedToId?: string
    lineKind?: string
    lineId?: string
  }) => api.post('/payroll-workflow/issues', data),
  issues: (params: { kind?: string; mine?: '1' }) => api.get<unknown, ReviewIssue[]>('/payroll-workflow/issues', { params }),
  respondIssue: (id: string, data: { response: string; reopen?: boolean }) =>
    api.post(`/payroll-workflow/issues/${id}/respond`, data),
  closeIssue: (id: string) => api.post(`/payroll-workflow/issues/${id}/close`),
  assignees: () =>
    api.get<unknown, Array<{ id: string; email: string; role: string; employee: { fullName: string } | null }>>(
      '/payroll-workflow/assignees',
    ),
}

/** Is this payroll activity open for me now (window, extension or executive)? */
export function useActivityWindow(activity: PayrollActivity) {
  const { data } = useQuery({
    queryKey: ['activity-windows', 'me'],
    queryFn: payrollMonthlyApi.myWindows,
    refetchInterval: 60_000,
  })
  return data?.find((w) => w.activity === activity)
}

/** "Open until 3 Nov, 12:00" / "Closed — window …". */
export function windowText(w?: ActivityWindow) {
  if (!w) return ''
  if (w.exempt) return 'No time limit (executive)'
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  if (w.open) return `Open until ${fmt(w.extensionUntil ?? w.closesAt)}${w.extensionUntil ? ' (IT extension)' : ''}`
  return `Closed — window ${fmt(w.opensAt)} to ${fmt(w.closesAt)}. Ask IT for an extension if needed.`
}
