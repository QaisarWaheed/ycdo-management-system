import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { isPortalAllowedRole } from '@/lib/portalRoles'
import { PortalLayout } from './PortalLayout'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth()
  const location = useLocation()

  if (!isAuthenticated || !isPortalAllowedRole(user?.role)) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          error: 'Access denied. Use HRMS for system access.',
          from: location.pathname,
        }}
      />
    )
  }

  return <PortalLayout>{children}</PortalLayout>
}
