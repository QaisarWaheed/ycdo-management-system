import { useAuthStore } from '@/store/auth.store'
import {
  isPortalEmployeeUser,
  isPortalExecutiveUser,
  userEffectiveRoles,
} from '@/lib/portalRoles'

export function useAuth() {
  const { token, user, isAuthenticated, login, logout, hydrate } =
    useAuthStore()

  const roles = userEffectiveRoles(user)

  return {
    token,
    user,
    isAuthenticated,
    login,
    logout,
    hydrate,
    roles,
    isEmployee: user?.role === 'EMPLOYEE',
    isPortalEmployee: isPortalEmployeeUser(user),
    isPortalExecutive: isPortalExecutiveUser(user),
    hasRole: (candidates: string | string[]) => {
      const list = Array.isArray(candidates) ? candidates : [candidates]
      return list.some((r) => roles.includes(r))
    },
  }
}
