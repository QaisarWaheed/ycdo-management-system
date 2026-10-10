import api from '../axios'

export interface BranchMonthLock {
  id: string
  name: string
  abbreviation?: string | null
  status: 'VERIFIED' | 'UNLOCKED' | null
  verifiedBy: string | null
  verifiedAt: string | null
  unlockedBy: string | null
  unlockedAt: string | null
  unlockReason: string | null
}

export interface MonthLockList {
  year: number
  month: number
  /** False while the month is still running. */
  canVerify: boolean
  branches: BranchMonthLock[]
}

export interface PayrollChange {
  id: string
  action: string
  summary: string
  netBefore: string | number | null
  netAfter: string | number | null
  createdAt: string
  user?: { email: string; employee?: { fullName: string } | null } | null
}

export const attendanceLocksApi = {
  list: (year: number, month: number) =>
    api.get<unknown, MonthLockList>('/attendance-locks', { params: { year, month } }),
  verify: (branchIds: string[], year: number, month: number) =>
    api.post<unknown, MonthLockList>('/attendance-locks/verify', { branchIds, year, month }),
  unlock: (branchId: string, year: number, month: number, reason: string) =>
    api.post<unknown, MonthLockList>('/attendance-locks/unlock', {
      branchId,
      year,
      month,
      reason,
    }),
}

export const payrollFinalizeApi = {
  finalize: (data: {
    branchId: string
    month: number
    year: number
    status: 'PROCESSED' | 'PAID'
  }) =>
    api.post<
      unknown,
      { total: number; done: number; failed: Array<{ employee: string; error: string }> }
    >('/payroll/finalize', data),
  changes: (entryId: string) =>
    api.get<unknown, PayrollChange[]>(`/payroll/entries/${entryId}/changes`),
}
