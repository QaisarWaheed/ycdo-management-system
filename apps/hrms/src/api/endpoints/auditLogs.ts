import api from '../axios'

export interface AuditLogEntry {
  id: string
  userId: string
  action: string
  entity: string
  entityId: string
  changes?: Record<string, unknown> | null
  createdAt: string
  description: string
  employeeName?: string | null
  user?: { id: string; email: string; role: string }
}

export const auditLogsApi = {
  getLogins: () =>
    api.get<
      unknown,
      Array<{
        id: string
        email: string
        role: string
        employee?: { fullName: string } | null
      }>
    >('/audit-logs/logins'),

  getAll: (params?: {
    actingUserId?: string
    limit?: number
    entity?: string
  }) => api.get<unknown, AuditLogEntry[]>('/audit-logs', { params }),
}
