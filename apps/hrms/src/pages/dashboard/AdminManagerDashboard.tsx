import { useQuery } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  Calendar,
  ChevronRight,
  Clock,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { attendanceApi } from '@/api/endpoints/attendance'
import { auditLogsApi } from '@/api/endpoints/auditLogs'
import { employeesApi } from '@/api/endpoints/employees'
import { leaveApi } from '@/api/endpoints/leave'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'

function todayRange() {
  const today = format(new Date(), 'yyyy-MM-dd')
  return { startDate: today, endDate: today }
}

function StatCard({
  label,
  value,
  icon: Icon,
  loading,
  iconBg,
  to,
  alertWhenPositive,
}: {
  label: string
  value: number
  icon: React.ElementType
  loading?: boolean
  iconBg: string
  to: string
  alertWhenPositive?: boolean
}) {
  const navigate = useNavigate()

  return (
    <Card
      className={cn(
        'relative cursor-pointer border-border shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md',
        alertWhenPositive && value > 0 && 'border-red-300 bg-red-50/50',
      )}
      role="button"
      tabIndex={0}
      onClick={() => navigate(to)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(to)
        }
      }}
    >
      <CardContent className="flex items-center gap-4 p-6">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${iconBg}`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          {loading ? (
            <Skeleton className="mb-2 h-8 w-16" />
          ) : (
            <p
              className={cn(
                'text-3xl font-bold',
                alertWhenPositive && value > 0
                  ? 'text-red-600'
                  : value === 0
                    ? 'text-text-secondary'
                    : 'text-text-primary',
              )}
            >
              {value}
            </p>
          )}
          <p className="text-sm text-text-secondary">{label}</p>
        </div>
        <ChevronRight className="absolute bottom-4 right-4 h-5 w-5 text-text-secondary/40" />
      </CardContent>
    </Card>
  )
}

function activityIcon(action: string) {
  if (action.includes('ATTENDANCE')) return Clock
  if (action.includes('LEAVE')) return Calendar
  if (action.includes('EMPLOYEE')) return UserPlus
  return UserCheck
}

export function AdminManagerDashboard() {
  const { user } = useAuth()
  const branchId = user?.branchId ?? undefined
  const today = todayRange()

  const branchQuery = branchId ? `branchId=${branchId}` : ''

  const { data: employeeCount, isLoading: loadingEmployees } = useQuery({
    queryKey: ['employees', 'count', branchId],
    queryFn: async () => {
      const res = await employeesApi.getCount({
        branchId,
        status: 'ACTIVE',
      })
      return res.count
    },
    enabled: !!branchId,
  })

  const { data: attendance = [], isLoading: loadingAttendance } = useQuery({
    queryKey: ['attendance', 'today', branchId],
    queryFn: () =>
      attendanceApi.getAll({ ...today, branchId }),
    enabled: !!branchId,
  })

  const { data: relievers = [], isLoading: loadingRelievers } = useQuery({
    queryKey: ['leave', 'today-relievers', branchId],
    queryFn: () => leaveApi.getTodayRelievers(branchId),
    enabled: !!branchId,
  })

  const { data: pendingLeaves = [], isLoading: loadingLeaves } = useQuery({
    queryKey: ['leave', 'pending', branchId],
    queryFn: () =>
      leaveApi.getAll({
        status: 'PENDING',
        branchId,
        pendingForRole: 'ADMIN_MANAGER',
        year: new Date().getFullYear(),
      }),
    enabled: !!branchId,
  })

  const { data: activity = [], isLoading: loadingActivity } = useQuery({
    queryKey: ['audit-logs', user?.id],
    queryFn: () =>
      auditLogsApi.getAll({ actingUserId: user!.id, limit: 20 }),
    enabled: !!user?.id,
  })

  const present = attendance.filter((l) => l.status === 'PRESENT').length
  const absent = attendance.filter((l) => l.status === 'ABSENT').length
  const uninformed = attendance.filter(
    (l) => l.status === 'UNINFORMED_ABSENT',
  ).length
  const late = attendance.filter((l) => l.status === 'LATE').length
  const onLeave = attendance.filter((l) => l.status === 'ON_LEAVE').length

  if (!branchId) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-text-secondary">
          Your account is not assigned to a branch. Contact HR to set your
          branch assignment.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Employees"
          value={employeeCount ?? 0}
          icon={Users}
          loading={loadingEmployees}
          iconBg="bg-blue-100 text-blue-700"
          to={`/employees?${branchQuery}`}
        />
        <StatCard
          label="Present Today"
          value={present}
          icon={UserCheck}
          loading={loadingAttendance}
          iconBg="bg-green-100 text-green-700"
          to={`/attendance?status=PRESENT&${branchQuery}&startDate=${today.startDate}&endDate=${today.endDate}`}
        />
        <StatCard
          label="Absent Today"
          value={absent}
          icon={UserX}
          loading={loadingAttendance}
          iconBg="bg-red-100 text-red-700"
          to={`/attendance?status=ABSENT&${branchQuery}&startDate=${today.startDate}&endDate=${today.endDate}`}
        />
        <StatCard
          label="Uninformed Absent"
          value={uninformed}
          icon={AlertTriangle}
          loading={loadingAttendance}
          iconBg="bg-orange-100 text-orange-700"
          to={`/attendance?status=UNINFORMED_ABSENT&${branchQuery}&startDate=${today.startDate}&endDate=${today.endDate}`}
          alertWhenPositive
        />
        <StatCard
          label="Late Staff Today"
          value={late}
          icon={Clock}
          loading={loadingAttendance}
          iconBg="bg-yellow-100 text-yellow-700"
          to={`/attendance?status=LATE&${branchQuery}&startDate=${today.startDate}&endDate=${today.endDate}`}
        />
        <StatCard
          label="Reliever"
          value={relievers.length}
          icon={Users}
          loading={loadingRelievers}
          iconBg="bg-purple-100 text-purple-700"
          to={`/leave?tab=relievers&${branchQuery}`}
        />
        <StatCard
          label="Pending Leaves"
          value={pendingLeaves.length}
          icon={Calendar}
          loading={loadingLeaves}
          iconBg="bg-amber-100 text-amber-700"
          to={`/leave?status=PENDING&${branchQuery}`}
        />
        <StatCard
          label="On Leave Today"
          value={onLeave}
          icon={Calendar}
          loading={loadingAttendance}
          iconBg="bg-sky-100 text-sky-700"
          to={`/attendance?status=ON_LEAVE&${branchQuery}&startDate=${today.startDate}&endDate=${today.endDate}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingActivity ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : activity.length === 0 ? (
            <p className="text-sm text-text-secondary">No recent activity</p>
          ) : (
            <ul className="space-y-4">
              {activity.map((item) => {
                const Icon = activityIcon(item.action)
                return (
                  <li key={item.id} className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-text-primary">
                        {item.description}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {formatDistanceToNow(new Date(item.createdAt), {
                          addSuffix: true,
                        })}
                      </p>
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
