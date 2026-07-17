import api from '../axios'

export type FaceSyncJobStatus =
  | 'PENDING'
  | 'SYNCED'
  | 'FAILED'
  | 'PARTIAL'

export type BiometricRegistrationStatus =
  | 'NOT_REGISTERED'
  | 'PARTIAL'
  | 'REGISTERED'

export interface BiometricRegistrationSummary {
  biometricId: string | null
  biometricIdAssigned: boolean
  registeredDeviceCount: number
  totalDevices: number
  registrationStatus: BiometricRegistrationStatus
  devices: Array<{
    deviceId: string
    label: string | null
    branchName: string
    registered: boolean
    lastSyncedAt: string | null
  }>
}

export interface FaceSyncStats {
  total?: number
  pending?: number
  synced?: number
  failed?: number
  partial?: number
  latestJob?: {
    id: string
    status: FaceSyncJobStatus
    createdAt: string
    updatedAt: string
  } | null
  registration?: BiometricRegistrationSummary
}

export interface FaceSyncJob {
  id: string
  employeeId: string
  photoUrl: string | null
  status: FaceSyncJobStatus
  createdAt: string
  updatedAt: string
  successCount: number
  deviceCount: number
  employee: {
    id: string
    fullName: string
    employeeCode: string
    photoUrl?: string | null
    hideProfilePhoto?: boolean
    hasPrivatePhoto?: boolean
  }
  results: Array<{
    id: string
    deviceId: string
    status: string
    error?: string | null
    syncedAt: string
    branch?: { name: string }
  }>
}

export const faceSyncApi = {
  getStats: (employeeId?: string) =>
    api.get<unknown, FaceSyncStats>('/face-sync/stats', {
      params: employeeId ? { employeeId } : undefined,
    }),

  getRegistration: (employeeId: string) =>
    api.get<unknown, BiometricRegistrationSummary>(
      `/face-sync/registration/${employeeId}`,
    ),

  listJobs: () => api.get<unknown, FaceSyncJob[]>('/face-sync/jobs'),

  syncEmployee: (employeeId: string) =>
    api.post<unknown, { id: string }>(`/face-sync/employee/${employeeId}`),

  syncAll: () =>
    api.post<
      unknown,
      { message: string; created: number; total: number }
    >('/face-sync/sync-all'),

  syncAllPreview: () =>
    api.get<unknown, number>('/face-sync/sync-all/preview'),
}
