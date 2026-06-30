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
  }
}

export const userPasswordsApi = {
  getAll: () => api.get<unknown, UserPasswordRecord[]>('/user-passwords'),
  resetPassword: (userId: string, newPassword: string) =>
    api.patch(`/user-passwords/${userId}`, { newPassword }),
}
