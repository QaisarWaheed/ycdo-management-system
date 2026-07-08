import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function AdminManagerPortalDashboard() {
  const { user } = useAuth()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Branch Dashboard</h1>
        <p className="text-sm text-text-secondary">
          Welcome, {user?.email}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Admin Manager Access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-text-secondary">
          <p>
            You are signed in as a branch Admin Manager. Use the HRMS application
            for attendance, employees, and leave management for your branch.
          </p>
          {user?.branchId && (
            <p>
              <span className="font-medium text-text-primary">Branch ID: </span>
              {user.branchId}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
