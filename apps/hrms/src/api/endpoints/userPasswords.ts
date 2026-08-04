import api from '../axios'

export interface UserPasswordRecord {
  id: string
  userId: string
  plainText: string
  createdAt: string
  updatedAt: string
  user: {
    email: string
    role: string
    isActive?: boolean
    branchId?: string | null
    employeeId?: string | null
    employee?: {
      fullName: string
      employeeCode: string
      biometricId?: string | null
      phone?: string | null
    } | null
    branch?: {
      id: string
      name: string
      address?: string | null
      projectId?: string | null
      project?: { id: string; name: string } | null
    } | null
  }
}

export interface PortalWhatsAppShareItem {
  userId: string
  employeeId: string | null
  employeeName: string
  employeeCode: string | null
  email: string
  password: string
  phone: string | null
  phoneE164: string | null
  ready: boolean
  skipReason: string | null
  message: string | null
  waUrl: string | null
}

export interface PortalWhatsAppSharesResponse {
  portalUrl: string
  total: number
  ready: number
  skipped: number
  items: PortalWhatsAppShareItem[]
}

export const userPasswordsApi = {
  getAll: (params?: {
    systemOnly?: boolean
    employeeOnly?: boolean
    branchId?: string
    projectId?: string
  }) =>
    api.get<unknown, UserPasswordRecord[]>('/user-passwords', {
      params: {
        ...(params?.systemOnly ? { systemOnly: 'true' } : {}),
        ...(params?.employeeOnly ? { employeeOnly: 'true' } : {}),
        ...(params?.branchId ? { branchId: params.branchId } : {}),
        ...(params?.projectId ? { projectId: params.projectId } : {}),
      },
    }),
  getPortalWhatsAppShares: (params?: {
    branchId?: string
    projectId?: string
    portalBaseUrl?: string
  }) =>
    api.get<unknown, PortalWhatsAppSharesResponse>(
      '/user-passwords/portal-whatsapp-shares',
      { params },
    ),
  getOnePortalWhatsAppShare: (userId: string, portalBaseUrl?: string) =>
    api.get<
      unknown,
      { portalUrl: string; item: PortalWhatsAppShareItem }
    >(`/user-passwords/${userId}/portal-whatsapp-share`, {
      params: portalBaseUrl ? { portalBaseUrl } : undefined,
    }),
  resetPassword: (userId: string, newPassword: string) =>
    api.patch(`/user-passwords/${userId}`, { newPassword }),
}
