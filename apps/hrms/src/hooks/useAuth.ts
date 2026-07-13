import { useAuthStore } from '@/store/auth.store'
import { roleAllowsPermission } from '@/lib/permissionDefaults'

export function useAuth() {
  const { token, user, isAuthenticated, login, logout, hydrate } =
    useAuthStore()

  const hasRole = (roles: string[]) => {
    if (!user?.role) return false
    return roles.includes(user.role)
  }

  const hasPermission = (permission: string) => {
    if (!user?.role) return false
    if (user.role === 'SUPER_ADMIN') return true
    if (user.permissions) {
      return user.permissions.includes(permission)
    }
    return roleAllowsPermission(user.role, permission)
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
    hasPermission,
    hasEmployeeProfile,
  }
}
