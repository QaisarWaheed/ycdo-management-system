import { useQuery } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Calendar,
  Clock,
  FileText,
  Palmtree,
  Receipt,
} from 'lucide-react'
import { acknowledgementsApi } from '@/api/endpoints/acknowledgements'
import { attendanceApi } from '@/api/endpoints/attendance'
import { employeesApi } from '@/api/endpoints/employees'
import { leaveApi } from '@/api/endpoints/leave'
import { notificationsApi } from '@/api/endpoints/notifications'
import { LiveTimerWidget } from '@/components/common/LiveTimerWidget'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/useAuth'
import { getGreeting } from '@/lib/helpers'
import type { LeaveRecord, Notification } from '@/types'

function StatCard({
  label,
  value,
  icon: Icon,
  loading,
  iconBg,
  subtitle,
}: {
  label: string
  value: number | string
  icon: React.ElementType
  loading?: boolean
  iconBg: string
  subtitle?: string
}) {
  return (
    <Card className="border-border shadow-sm">
      <CardContent className="flex items-center gap-4 p-5">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-full ${iconBg}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          {loading ? (
            <Skeleton className="mb-2 h-7 w-12" />
          ) : (
            <p className="text-2xl font-bold text-text-primary">{value}</p>
          )}
          <p className="text-sm text-text-secondary">{label}</p>
          {subtitle && (
            <p className="text-xs text-text-secondary/80">{subtitle}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const { user } = useAuth()
  const employeeId = user?.employeeId ?? ''
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const { data: employee } = useQuery({
    queryKey: ['employee-dashboard', employeeId],
    queryFn: () => employeesApi.getOne(employeeId),
    enabled: !!employeeId,
  })

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['attendance-summary', employeeId, month, year],
    queryFn: () => attendanceApi.getMySummary(employeeId, month, year),
    enabled: !!employeeId,
  })

  const { data: balance, isLoading: loadingBalance } = useQuery({
    queryKey: ['leave-balance', employeeId, year],
    queryFn: () => leaveApi.getMyBalance(employeeId, year),
    enabled: !!employeeId,
  })

  const { data: leaves = [], isLoading: loadingLeaves } = useQuery({
    queryKey: ['leave', 'my-pending'],
    queryFn: () => leaveApi.getMy({ status: 'PENDING' }),
    enabled: !!employeeId,
  })

  const { data: unread, isLoading: loadingUnread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.getUnreadCount(),
    enabled: !!employeeId,
  })

  const { data: notifications = [], isLoading: loadingNotifications } =
    useQuery({
      queryKey: ['notifications'],
      queryFn: () => notificationsApi.getMy(),
      enabled: !!employeeId,
    })

  const { data: pendingAcks = [] } = useQuery({
    queryKey: ['acknowledgements', 'pending'],
    queryFn: () => acknowledgementsApi.getPending(),
    enabled: !!employeeId,
  })

  const pendingAckCount = pendingAcks.length

  const displayName = employee
    ? employee.firstName
    : user?.email?.split('@')[0] ?? 'there'

  const recentNotifications = (notifications as Notification[]).slice(0, 3)
  const pendingCount = (leaves as LeaveRecord[]).length

  const quickActions = [
    { to: '/leave', label: 'Apply Leave', icon: Palmtree },
    { to: '/attendance', label: 'My Attendance', icon: Clock },
    { to: '/payroll', label: 'View Payslips', icon: Receipt },
    { to: '/letters', label: 'My Letters', icon: FileText },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          {getGreeting()}, {displayName}!
        </h1>
        <p className="text-sm text-text-secondary">
          {format(now, 'EEEE, dd MMMM yyyy')}
          {employee?.currentDesignation && (
            <> · {employee.currentDesignation}</>
          )}
        </p>
      </div>

      {pendingAckCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-start gap-2 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              You have {pendingAckCount} letter
              {pendingAckCount !== 1 ? 's' : ''} requiring acknowledgement
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-red-300 bg-white text-red-800 hover:bg-red-100"
            asChild
          >
            <Link to="/letters">View Letters</Link>
          </Button>
        </div>
      )}

      {employeeId && (
        <LiveTimerWidget
          employeeId={employeeId}
          shift={employee?.shift ?? undefined}
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Present This Month"
          value={summary?.present ?? 0}
          icon={Calendar}
          loading={loadingSummary}
          iconBg="bg-accent/10 text-accent-dark"
          subtitle={format(now, 'MMMM yyyy')}
        />
        <StatCard
          label="Leave Balance"
          value={balance?.remaining ?? '—'}
          icon={Palmtree}
          loading={loadingBalance}
          iconBg="bg-primary/10 text-primary"
          subtitle={
            balance
              ? `${balance.taken} taken of ${balance.totalAllowed}`
              : undefined
          }
        />
        <StatCard
          label="Pending Leave"
          value={pendingCount}
          icon={Clock}
          loading={loadingLeaves}
          iconBg="bg-amber-100 text-amber-700"
          subtitle="Awaiting approval"
        />
        <StatCard
          label="Unread Notifications"
          value={unread?.count ?? 0}
          icon={FileText}
          loading={loadingUnread}
          iconBg="bg-blue-100 text-blue-700"
        />
      </div>

      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {quickActions.map(({ to, label, icon: Icon }) => (
              <Button
                key={to}
                variant="outline"
                className="h-auto flex-col gap-2 py-4"
                asChild
              >
                <Link to={to}>
                  <Icon className="h-5 w-5 text-primary" />
                  <span className="text-xs">{label}</span>
                </Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg">Recent Notifications</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {loadingNotifications ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : recentNotifications.length === 0 ? (
            <p className="text-sm text-text-secondary">No notifications yet</p>
          ) : (
            <ul className="space-y-3">
              {recentNotifications.map((n) => (
                <li
                  key={n.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div>
                    <p
                      className={`text-sm ${!n.isRead ? 'font-semibold' : ''}`}
                    >
                      {n.message}
                    </p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {formatDistanceToNow(new Date(n.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  {!n.isRead && (
                    <Badge className="shrink-0 bg-accent hover:bg-accent">
                      New
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
