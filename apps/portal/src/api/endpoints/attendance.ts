import api from '../axios'
import type {
  ActiveTimer,
  AttendanceLog,
  AttendanceSummary,
  RelieverSummary,
} from '@/types'

export interface PortalCheckPayload {
  latitude: number
  longitude: number
}

export interface PortalCheckInResponse {
  success: boolean
  distance: number
  message: string
}

export interface PortalCheckOutResponse {
  success: boolean
  hoursWorked: number
  distance: number
}

export const attendanceApi = {
  getMy: (params?: Record<string, unknown>) =>
    api.get<unknown, AttendanceLog[]>('/attendance', { params }),
  getMySummary: (employeeId: string, month: number, year: number) =>
    api.get<unknown, AttendanceSummary>(
      `/attendance/summary/${employeeId}`,
      { params: { month, year } },
    ),
  getMyTimer: (employeeId: string) =>
    api.get<unknown, ActiveTimer>(`/attendance/timer/${employeeId}`),
  getMyReliever: (
    employeeId: string,
    params: { month: number; year: number },
  ) =>
    api.get<unknown, RelieverSummary>(
      `/attendance/reliever/${employeeId}`,
      { params },
    ),
  portalCheckIn: (data: PortalCheckPayload) =>
    api.post<unknown, PortalCheckInResponse>(
      '/attendance/portal-checkin',
      data,
    ),
  portalCheckOut: (data: PortalCheckPayload) =>
    api.post<unknown, PortalCheckOutResponse>(
      '/attendance/portal-checkout',
      data,
    ),
}
