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
  markAbsentees: (date: string) =>
    api.post('/attendance/mark-absentees', { date }),
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
    shiftId?: string
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
