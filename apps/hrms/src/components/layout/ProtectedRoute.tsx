import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { isHrmsSystemUser } from '@/lib/hrmsAccess'
import { AppLayout } from './AppLayout'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth()

  if (!isAuthenticated || !isHrmsSystemUser(user)) {
    return <Navigate to="/login" replace />
  }

  return <AppLayout>{children}</AppLayout>
}
