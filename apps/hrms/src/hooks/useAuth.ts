import { useAuthStore } from '@/store/auth.store'
import { roleAllowsPermission } from '@/lib/permissionDefaults'

export function useAuth() {
  const { token, user, isAuthenticated, login, logout, hydrate } =
    useAuthStore()

  const effectiveRoles = user?.roles?.length
    ? user.roles
    : user?.role
      ? [user.role]
      : []

  const hasRole = (roles: string[]) => {
    if (!effectiveRoles.length) return false
    return roles.some((role) => effectiveRoles.includes(role))
  }

  const hasPermission = (permission: string) => {
    if (!user) return false
    if (effectiveRoles.includes('SUPER_ADMIN')) return true
    if (user.permissions) {
      return user.permissions.includes(permission)
    }
    return effectiveRoles.some((role) =>
      roleAllowsPermission(role, permission),
    )
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
    roles: effectiveRoles,
  }
}
