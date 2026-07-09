import api from '../axios'
import type { AuthLoginResponse, User } from '@/types'

export const authApi = {
  login: (email: string, password: string) =>
    api.post<unknown, AuthLoginResponse>('/auth/login', {
      email,
      password,
      client: 'hrms',
    }),
  me: () => api.get<unknown, User>('/auth/me'),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.patch<unknown, { message: string }>('/auth/change-password', data),
  resetPassword: (data: { userId: string; newPassword: string }) =>
    api.patch<unknown, { message: string }>('/auth/reset-password', data),
}
