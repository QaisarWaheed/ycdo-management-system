import { useAuthStore } from '@/store/auth.store'

export function useAuth() {
  const { token, user, isAuthenticated, login, logout, hydrate } =
    useAuthStore()

  return {
    token,
    user,
    isAuthenticated,
    login,
    logout,
    hydrate,
    isEmployee: user?.role === 'EMPLOYEE',
  }
}
