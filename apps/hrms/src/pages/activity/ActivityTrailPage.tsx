import { useQuery } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Calendar,
  Clock,
  History,
  UserCheck,
  UserPlus,
} from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { auditLogsApi } from '@/api/endpoints/auditLogs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/useAuth'

const ACTIVITY_TRAIL_ROLES = ['SUPER_ADMIN'] as const

function activityIcon(action: string) {
  if (action.includes('ATTENDANCE')) return Clock
  if (action.includes('LEAVE')) return Calendar
  if (action.includes('EMPLOYEE')) return UserPlus
  if (action.includes('PAYROLL') || action.includes('SALARY')) return UserCheck
  return History
}

function formatRole(role: string) {
  return role.replace(/_/g, ' ')
}

export function ActivityTrailPage() {
  const { user } = useAuth()

  const canView =
    user?.role &&
    ACTIVITY_TRAIL_ROLES.includes(
      user.role as (typeof ACTIVITY_TRAIL_ROLES)[number],
    )

  const { data: activity = [], isLoading } = useQuery({
    queryKey: ['audit-logs', 'activity-trail'],
    queryFn: () => auditLogsApi.getAll({ limit: 100 }),
    enabled: !!canView,
    refetchInterval: 60_000,
  })

  if (!canView) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Activity Trail</h1>
        <p className="mt-1 text-sm text-text-secondary">
          System-wide log of HR and admin actions across the platform.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            All Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : activity.length === 0 ? (
            <p className="text-sm text-text-secondary">No activity recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {activity.map((item) => {
                const Icon = activityIcon(item.action)
                return (
                  <li
                    key={item.id}
                    className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary">
                        {item.description}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                        <span>
                          {item.user?.email ?? 'Unknown user'}
                          {item.user?.role
                            ? ` · ${formatRole(item.user.role)}`
                            : ''}
                        </span>
                        <span>
                          {format(new Date(item.createdAt), 'dd MMM yyyy, hh:mm a')}
                        </span>
                        <span>
                          {formatDistanceToNow(new Date(item.createdAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
