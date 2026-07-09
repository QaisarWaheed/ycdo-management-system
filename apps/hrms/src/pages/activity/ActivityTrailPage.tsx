import { useMemo, useState } from 'react'
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
import { TablePagination } from '@/components/common/TablePagination'
import { TableRecordCount } from '@/components/common/TableRecordCount'
import { auditLogsApi } from '@/api/endpoints/auditLogs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/useAuth'
import { usePagination } from '@/hooks/usePagination'

const ACTIVITY_TRAIL_ROLES = ['SUPER_ADMIN'] as const
const ALL_LOGINS = 'all'

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

function loginLabel(login: {
  email: string
  role: string
  employee?: { fullName: string } | null
}) {
  const name = login.employee?.fullName
  if (name) {
    return `${login.email} (${name})`
  }
  return `${login.email} (${formatRole(login.role)})`
}

export function ActivityTrailPage() {
  const { user } = useAuth()
  const [selectedLogin, setSelectedLogin] = useState(ALL_LOGINS)
  const [loginSearch, setLoginSearch] = useState('')

  const canView =
    user?.role &&
    ACTIVITY_TRAIL_ROLES.includes(
      user.role as (typeof ACTIVITY_TRAIL_ROLES)[number],
    )

  const { data: logins = [], isLoading: loadingLogins } = useQuery({
    queryKey: ['audit-logs', 'logins'],
    queryFn: () => auditLogsApi.getLogins(),
    enabled: !!canView,
  })

  const filteredLogins = useMemo(() => {
    const q = loginSearch.trim().toLowerCase()
    if (!q) return logins
    return logins.filter((login) => {
      const haystack = [
        login.email,
        login.role,
        login.employee?.fullName ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [logins, loginSearch])

  const { data: activity = [], isLoading: loadingActivity } = useQuery({
    queryKey: ['audit-logs', 'activity-trail', selectedLogin],
    queryFn: () =>
      auditLogsApi.getAll({
        limit: 100,
        ...(selectedLogin !== ALL_LOGINS
          ? { actingUserId: selectedLogin }
          : {}),
      }),
    enabled: !!canView,
    refetchInterval: 60_000,
  })

  const { page, setPage, totalPages, paginated, total } = usePagination(
    activity,
    [selectedLogin],
  )

  if (!canView) {
    return <Navigate to="/dashboard" replace />
  }

  const selectedLoginLabel =
    selectedLogin === ALL_LOGINS
      ? 'All logins'
      : logins.find((login) => login.id === selectedLogin)?.email ?? 'Selected login'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Activity Trail</h1>
        <p className="mt-1 text-sm text-text-secondary">
          System-wide log of HR and admin actions across the platform.
        </p>
      </div>

      <TableRecordCount count={total} label="activity record" />

      <Card>
        <CardHeader className="space-y-4">
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            {selectedLogin === ALL_LOGINS ? 'All Activity' : 'Filtered Activity'}
          </CardTitle>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="login-search">Search logins</Label>
              <Input
                id="login-search"
                placeholder="Search by email, name, or role..."
                value={loginSearch}
                onChange={(e) => setLoginSearch(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-filter">Login filter</Label>
              <Select value={selectedLogin} onValueChange={setSelectedLogin}>
                <SelectTrigger id="login-filter">
                  <SelectValue placeholder="All logins" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_LOGINS}>All logins</SelectItem>
                  {loadingLogins ? (
                    <SelectItem value="loading" disabled>
                      Loading logins...
                    </SelectItem>
                  ) : (
                    filteredLogins.map((login) => (
                      <SelectItem key={login.id} value={login.id}>
                        {loginLabel(login)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedLogin !== ALL_LOGINS && (
            <p className="text-sm text-text-secondary">
              Showing activity for <span className="font-medium">{selectedLoginLabel}</span>
            </p>
          )}
        </CardHeader>

        <CardContent>
          {loadingActivity ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : paginated.length === 0 ? (
            <p className="text-sm text-text-secondary">
              {selectedLogin === ALL_LOGINS
                ? 'No activity recorded yet.'
                : 'No activity found for this login.'}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {paginated.map((item) => {
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

              <TablePagination
                page={page}
                totalPages={totalPages}
                total={total}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
