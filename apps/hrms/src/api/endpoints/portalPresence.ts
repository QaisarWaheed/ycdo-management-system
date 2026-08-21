import api from '../axios'

export type PortalPresenceStatus = 'ONLINE' | 'OFFLINE' | 'NEVER_LOGGED_IN'

export interface PortalPresenceSummary {
  withPortalAccount: number
  online: number
  offline: number
  neverLoggedIn: number
  onlineWindowMinutes: number
}

export interface PortalPresenceRow {
  userId: string
  email: string
  isActive: boolean
  lastLogin: string | null
  lastPortalLogin: string | null
  status: PortalPresenceStatus
  employee: {
    id: string
    fullName: string
    employeeCode: string
    status: string
    branch: { id: string; name: string } | null
    department: { id: string; name: string } | null
  } | null
}

export interface PortalPresenceQuery {
  search?: string
  branchId?: string
  status?: PortalPresenceStatus
}

export const portalPresenceApi = {
  getSummary: () =>
    api
      .get<PortalPresenceSummary>('/portal-presence/summary')
      .then((r) => r.data),

  getAll: (params?: PortalPresenceQuery) =>
    api
      .get<PortalPresenceRow[]>('/portal-presence', { params })
      .then((r) => r.data),
}
