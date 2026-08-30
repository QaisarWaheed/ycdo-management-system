import api from '../axios'
import type { AttendanceLog, AttendanceSummary, RelieverSession } from '@/types'

export const attendanceApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<unknown, AttendanceLog[]>('/attendance', { params }),
  getSummary: (employeeId: string, month: number, year: number) =>
    api.get<unknown, AttendanceSummary>(`/attendance/summary/${employeeId}`, {
      params: { month, year },
    }),
  markManual: (data: Record<string, unknown>) =>
    api.post('/attendance/manual', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<unknown, AttendanceLog>(`/attendance/${id}`, data),
  approveOvertime: (id: string, overtimeMinutes: number) =>
    api.patch(`/attendance/${id}/approve-overtime`, { overtimeMinutes }),
  markAbsentees: (date: string) =>
    api.post('/attendance/mark-absentees', { date }),
  backfillAbsent: (data: { date: string; shiftName?: string }) =>
    api.post('/attendance/backfill-absent', data),
  getTimer: (employeeId: string) =>
    api.get(`/attendance/timer/${employeeId}`),
  getRelieverSessions: (
    employeeId: string,
    params: { month: number; year: number },
  ) =>
    api.get<
      unknown,
      { sessions: unknown[]; totalMinutes: number; totalHours: number }
    >(`/attendance/reliever/${employeeId}`, { params }),
  getSuspensionWatchlist: (params?: { month?: number; year?: number }) =>
    api.get<
      unknown,
      {
        month: string
        year: number
        monthNumber: number
        near: Array<{
          employeeId: string
          fullName: string
          employeeCode: string | null
          biometricId: string | null
          phone: string | null
          branchId: string | null
          branchName: string | null
          lateDays: number
          uninformedAbsentDays: number
          reasons: Array<'LATE_NEAR' | 'LATE_DUE' | 'UA_NEAR' | 'UA_DUE'>
        }>
        due: Array<{
          employeeId: string
          fullName: string
          employeeCode: string | null
          biometricId: string | null
          phone: string | null
          branchId: string | null
          branchName: string | null
          lateDays: number
          uninformedAbsentDays: number
          reasons: Array<'LATE_NEAR' | 'LATE_DUE' | 'UA_NEAR' | 'UA_DUE'>
        }>
        counts: { near: number; due: number }
      }
    >('/attendance/suspension-watchlist', { params }),
  sendNearSuspensionReminder: (
    employeeId: string,
    params?: { month?: number; year?: number },
  ) =>
    api.post<
      unknown,
      {
        letterId: string
        letterNo: string | null
        status: string
        alreadySent: boolean
      }
    >(
      `/attendance/suspension-watchlist/${employeeId}/reminder`,
      {},
      { params },
    ),
  startSuspensionCaseFromWatchlist: (
    employeeId: string,
    data: {
      durationDays: number
      inquiryOfficerUserId?: string
      inquiryOfficerName: string
      inquiryOfficerDesignation?: string
      inquiryOfficerPhone: string
      selectedApproverUserId: string
      approverWhatsApp: string
    },
    params?: { month?: number; year?: number },
  ) =>
    api.post<unknown, { id: string }>(
      `/attendance/suspension-watchlist/${employeeId}/start-case`,
      data,
      { params },
    ),
  getDueInquiryPreview: (
    employeeId: string,
    params?: { month?: number; year?: number },
  ) =>
    api.get<
      unknown,
      {
        employeeId: string
        fullName: string
        employeeCode: string | null
        month: string
        lateDays: number
        uninformedAbsentDays: number
        reasons: string[]
        reason: string
      }
    >(`/attendance/suspension-watchlist/${employeeId}/inquiry-preview`, {
      params,
    }),
  listRelieverSessions: (params?: {
    startDate?: string
    endDate?: string
    branchId?: string
    projectId?: string
    departmentId?: string
    shiftIds?: string
    employeeStatus?: string
    gender?: string
    designation?: string
    district?: string
  }) =>
    api.get<unknown, RelieverSession[]>(
      '/attendance/reliever-sessions',
      { params },
    ),
  relieverCheckIn: (data: {
    employeeId: string
    date: string
    checkIn?: string
  }) => api.post('/attendance/reliever-sessions/check-in', data),
  relieverCheckOut: (data: { sessionId: string; checkOut?: string }) =>
    api.post('/attendance/reliever-sessions/check-out', data),
  updateRelieverSession: (
    sessionId: string,
    data: { checkIn?: string; checkOut?: string },
  ) =>
    api.patch<unknown, RelieverSession>(
      `/attendance/reliever-sessions/${sessionId}`,
      data,
    ),
}
