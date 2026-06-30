import { useAuthStore } from '@/store/auth.store'

export function useAuth() {
  const { token, user, isAuthenticated, login, logout, hydrate } =
    useAuthStore()

  const hasRole = (roles: string[]) => {
    if (!user?.role) return false
    return roles.includes(user.role)
  }

  const hasEmployeeProfile = !!user?.employeeId

  return {
    token,
    user,
    isAuthenticated,
    login,
    logout,
    hydrate,
    hasRole,
    hasEmployeeProfile,
  }
}
