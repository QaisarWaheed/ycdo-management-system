import api from '../axios'

export type FaceSyncJobStatus =
  | 'PENDING'
  | 'SYNCED'
  | 'FAILED'
  | 'PARTIAL'

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
}

export interface FaceSyncJob {
  id: string
  employeeId: string
  photoUrl: string
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
