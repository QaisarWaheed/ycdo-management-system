import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { canAccessPortal } from '@/lib/portalRoles'
import { PortalLayout } from './PortalLayout'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth()
  const location = useLocation()

  if (!isAuthenticated || !canAccessPortal(user)) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          error: 'Please sign in to continue.',
          from: location.pathname,
        }}
      />
    )
  }

  return <PortalLayout>{children}</PortalLayout>
}
