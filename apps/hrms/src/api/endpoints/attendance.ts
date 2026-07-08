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
}
