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
    branch?: {
      id: string
      name: string
      address?: string | null
      projectId?: string | null
      project?: { id: string; name: string } | null
    } | null
  }
}

export const userPasswordsApi = {
  getAll: (params?: {
    systemOnly?: boolean
    branchId?: string
    projectId?: string
  }) =>
    api.get<unknown, UserPasswordRecord[]>('/user-passwords', {
      params: {
        ...(params?.systemOnly ? { systemOnly: 'true' } : {}),
        ...(params?.branchId ? { branchId: params.branchId } : {}),
        ...(params?.projectId ? { projectId: params.projectId } : {}),
      },
    }),
  resetPassword: (userId: string, newPassword: string) =>
    api.patch(`/user-passwords/${userId}`, { newPassword }),
}
