import api from '../axios'
import type {
  AuthLoginResponse,
  AuthLoginResult,
  AuthOtpChallengeResponse,
  User,
} from '@/types'

export const authApi = {
  login: (email: string, password: string) =>
    api.post<unknown, AuthLoginResult>('/auth/login', {
      email,
      password,
      client: 'hrms',
    }),
  verifyOtp: (challengeId: string, otp: string) =>
    api.post<unknown, AuthLoginResponse>('/auth/verify-otp', {
      challengeId,
      otp,
    }),
  resendOtp: (challengeId: string) =>
    api.post<unknown, AuthOtpChallengeResponse>('/auth/resend-otp', {
      challengeId,
    }),
  me: () => api.get<unknown, User>('/auth/me'),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.patch<unknown, { message: string }>('/auth/change-password', data),
  resetPassword: (data: { userId: string; newPassword: string }) =>
    api.patch<unknown, { message: string }>('/auth/reset-password', data),
}
