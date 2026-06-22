import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { PortalLayout } from './PortalLayout'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth()
  const location = useLocation()

  if (!isAuthenticated || user?.role !== 'EMPLOYEE') {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          error: 'You must be logged in as an employee to access this portal.',
          from: location.pathname,
        }}
      />
    )
  }

  return <PortalLayout>{children}</PortalLayout>
}
