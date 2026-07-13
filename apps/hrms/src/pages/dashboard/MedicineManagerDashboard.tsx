import { useQuery } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Calendar,
  ChevronRight,
  CircleDashed,
  Clock,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { attendanceApi } from '@/api/endpoints/attendance'
import { auditLogsApi } from '@/api/endpoints/auditLogs'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import {
  MEDICINE_DEPARTMENT_NAME,
  isMedicineDepartmentName,
} from '@/lib/medicineScope'

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

export function MedicineManagerDashboard() {
  const { user } = useAuth()
  const today = todayRange()

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll(),
  })

  const medicineDeptId = departments.find((d) =>
    isMedicineDepartmentName(d.name),
  )?.id

  const deptQuery = medicineDeptId ? `departmentId=${medicineDeptId}` : ''

  const { data: employeeCount, isLoading: loadingEmployees } = useQuery({
    queryKey: ['employees', 'count', 'medicine', medicineDeptId],
    queryFn: async () => {
      const res = await employeesApi.getCount({
        status: 'ACTIVE',
        ...(medicineDeptId ? { departmentId: medicineDeptId } : {}),
      })
      return res.count
    },
  })

  const { data: attendance = [], isLoading: loadingAttendance } = useQuery({
    queryKey: ['attendance', 'today', 'medicine', medicineDeptId],
    queryFn: () =>
      attendanceApi.getAll({
        ...today,
        ...(medicineDeptId ? { departmentId: medicineDeptId } : {}),
      }),
  })

  const { data: activity = [], isLoading: loadingActivity } = useQuery({
    queryKey: ['audit-logs', user?.id],
    queryFn: () =>
      auditLogsApi.getAll({ actingUserId: user!.id, limit: 20 }),
    enabled: !!user?.id,
  })

  const unmarked = attendance.filter((l) => l.status === 'UNMARKED').length
  const present = attendance.filter((l) => l.status === 'PRESENT').length
  const absent = attendance.filter((l) => l.status === 'ABSENT').length
  const uninformed = attendance.filter(
    (l) => l.status === 'UNINFORMED_ABSENT',
  ).length
  const late = attendance.filter((l) => l.status === 'LATE').length
  const onLeave = attendance.filter((l) => l.status === 'ON_LEAVE').length

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 text-sm">
          <p className="font-medium">Medicine Management System</p>
          <p className="mt-1 text-text-secondary">
            You can mark attendance only for staff under{' '}
            {MEDICINE_DEPARTMENT_NAME} (and related designations).
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Medicine Staff"
          value={employeeCount ?? 0}
          icon={Users}
          loading={loadingEmployees}
          iconBg="bg-blue-100 text-blue-700"
          to={`/employees?${deptQuery}`}
        />
        <StatCard
          label="Unmarked Today"
          value={unmarked}
          icon={CircleDashed}
          loading={loadingAttendance}
          iconBg="bg-slate-100 text-slate-700"
          to={`/attendance?status=UNMARKED&${deptQuery}&startDate=${today.startDate}&endDate=${today.endDate}`}
          alertWhenPositive
        />
        <StatCard
          label="Present Today"
          value={present}
          icon={UserCheck}
          loading={loadingAttendance}
          iconBg="bg-green-100 text-green-700"
          to={`/attendance?status=PRESENT&${deptQuery}&startDate=${today.startDate}&endDate=${today.endDate}`}
        />
        <StatCard
          label="Absent Today"
          value={absent}
          icon={UserX}
          loading={loadingAttendance}
          iconBg="bg-red-100 text-red-700"
          to={`/attendance?status=ABSENT&${deptQuery}&startDate=${today.startDate}&endDate=${today.endDate}`}
        />
        <StatCard
          label="Uninformed Absent"
          value={uninformed}
          icon={UserX}
          loading={loadingAttendance}
          iconBg="bg-orange-100 text-orange-700"
          to={`/attendance?status=UNINFORMED_ABSENT&${deptQuery}&startDate=${today.startDate}&endDate=${today.endDate}`}
        />
        <StatCard
          label="Late Today"
          value={late}
          icon={Clock}
          loading={loadingAttendance}
          iconBg="bg-amber-100 text-amber-700"
          to={`/attendance?status=LATE&${deptQuery}&startDate=${today.startDate}&endDate=${today.endDate}`}
        />
        <StatCard
          label="On Leave Today"
          value={onLeave}
          icon={Calendar}
          loading={loadingAttendance}
          iconBg="bg-purple-100 text-purple-700"
          to={`/attendance?status=ON_LEAVE&${deptQuery}&startDate=${today.startDate}&endDate=${today.endDate}`}
        />
        <StatCard
          label="Mark Attendance"
          value={unmarked}
          icon={UserCheck}
          loading={loadingAttendance}
          iconBg="bg-teal-100 text-teal-700"
          to="/attendance?tab=manual"
          alertWhenPositive
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingActivity ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p className="text-sm text-text-secondary">No recent activity</p>
          ) : (
            <div className="space-y-3">
              {activity.slice(0, 10).map((log) => {
                const Icon = activityIcon(log.action)
                return (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="mt-0.5 rounded-full bg-muted p-2">
                      <Icon className="h-4 w-4 text-text-secondary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {log.action.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {log.entity} ·{' '}
                        {formatDistanceToNow(new Date(log.createdAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
