import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  AlertTriangle,
  Calendar,
  ChevronRight,
  Clock,
  Timer,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { attendanceApi } from '@/api/endpoints/attendance'
import { disciplinaryApi } from '@/api/endpoints/disciplinary'
import { employeesApi } from '@/api/endpoints/employees'
import { leaveApi } from '@/api/endpoints/leave'
import { recruitmentApi } from '@/api/endpoints/recruitment'
import type { AttendanceLog, Employee, LeaveRecord } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/hooks/useAuth'
import { BranchManagerDashboard } from '@/pages/dashboard/BranchManagerDashboard'
import { DeptInchargeDashboard } from '@/pages/dashboard/DeptInchargeDashboard'
import { ExecutiveDashboard } from '@/pages/dashboard/ExecutiveDashboard'
import { HrOperationsDashboard } from '@/pages/dashboard/HrOperationsDashboard'

function todayRange() {
  const today = format(new Date(), 'yyyy-MM-dd')
  return { startDate: today, endDate: today }
}

function StatCard({
  label,
  value,
  icon: Icon,
  subtitle,
  loading,
  error,
  iconBg,
  to,
}: {
  label: string
  value: number
  icon: React.ElementType
  subtitle?: string
  loading?: boolean
  error?: boolean
  iconBg: string
  to: string
}) {
  const navigate = useNavigate()

  const displayValue = error ? '—' : value

  return (
    <Card
      className="relative cursor-pointer border-border shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md"
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
                error
                  ? 'text-text-secondary'
                  : value === 0
                    ? 'text-text-secondary'
                    : 'text-text-primary',
              )}
            >
              {displayValue}
            </p>
          )}
          <p className="text-sm text-text-secondary">{label}</p>
          {subtitle && (
            <p className="text-xs text-text-secondary/80">{subtitle}</p>
          )}
        </div>
        <ChevronRight className="absolute bottom-4 right-4 h-5 w-5 text-text-secondary/40" />
      </CardContent>
    </Card>
  )
}

function statusBadge(status: string) {
  const variants: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    PENDING: 'bg-yellow-100 text-yellow-800',
    APPROVED: 'bg-green-100 text-green-800',
    REJECTED: 'bg-red-100 text-red-800',
    PRESENT: 'bg-green-100 text-green-800',
    ABSENT: 'bg-red-100 text-red-800',
  }
  return (
    <Badge variant="outline" className={variants[status] ?? ''}>
      {status}
    </Badge>
  )
}

function ViewAllLink({ to, label = 'View All →' }: { to: string; label?: string }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="text-sm font-medium text-primary hover:underline"
      onClick={() => navigate(to)}
    >
      {label}
    </button>
  )
}

export function DashboardPage() {
  const { user } = useAuth()
  const role = user?.role

  if (role === 'BRANCH_MANAGER') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <BranchManagerDashboard />
      </div>
    )
  }

  if (role === 'ADMIN_OFFICER') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <DeptInchargeDashboard />
      </div>
    )
  }

  if (role === 'HR_OPERATIONS_MANAGER') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <HrOperationsDashboard />
      </div>
    )
  }

  if (role === 'CHAIRMAN' || role === 'FOUNDER') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-text-primary">
          Organization Overview
        </h1>
        <ExecutiveDashboard />
      </div>
    )
  }

  return <AdminDashboard />
}

function AdminDashboard() {
  const navigate = useNavigate()
  const today = todayRange()

  const {
    data: employees,
    isLoading: loadingEmployees,
    isError: errorEmployees,
  } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.getAll(),
  })

  const {
    data: attendance,
    isLoading: loadingAttendance,
    isError: errorAttendance,
  } = useQuery({
    queryKey: ['attendance', 'today', today],
    queryFn: () => attendanceApi.getAll(today),
  })

  const {
    data: leaves,
    isLoading: loadingLeaves,
    isError: errorLeaves,
  } = useQuery({
    queryKey: ['leave', 'pending'],
    queryFn: () => leaveApi.getAll({ status: 'PENDING' }),
  })

  const {
    data: disciplinary,
    isLoading: loadingDisciplinary,
    isError: errorDisciplinary,
  } = useQuery({
    queryKey: ['disciplinary', 'open'],
    queryFn: () => disciplinaryApi.getAll({ status: 'OPEN' }),
  })

  const {
    data: applications,
    isLoading: loadingApplications,
    isError: errorApplications,
  } = useQuery({
    queryKey: ['recruitment', 'applied'],
    queryFn: () => recruitmentApi.getAll({ status: 'APPLIED' }),
  })

  const {
    data: relieverSessions = [],
    isLoading: loadingRelievers,
    isError: errorRelievers,
  } = useQuery({
    queryKey: ['reliever-sessions', 'today', today],
    queryFn: () =>
      attendanceApi.listRelieverSessions({
        startDate: today.startDate,
        endDate: today.endDate,
      }),
  })

  const attendanceLogs = (attendance ?? []) as AttendanceLog[]
  const presentToday = attendanceLogs.filter((l) => l.status === 'PRESENT').length
  const absentToday = attendanceLogs.filter((l) => l.status === 'ABSENT').length
  const lateToday = attendanceLogs.filter((l) => l.status === 'LATE').length
  const onLeaveToday = attendanceLogs.filter((l) => l.status === 'ON_LEAVE').length

  const recentEmployees = ((employees ?? []) as Employee[]).slice(0, 5)
  const recentLeaves = ((leaves ?? []) as LeaveRecord[]).slice(0, 5)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Total Employees"
          value={(employees ?? []).length}
          icon={Users}
          loading={loadingEmployees}
          error={errorEmployees}
          iconBg="bg-primary/10 text-primary"
          subtitle="Active workforce"
          to="/employees"
        />
        <StatCard
          label="Present Today"
          value={presentToday}
          icon={Clock}
          loading={loadingAttendance}
          error={errorAttendance}
          iconBg="bg-accent/10 text-accent-dark"
          subtitle={format(new Date(), 'dd MMM yyyy')}
          to="/attendance?date=today&status=PRESENT"
        />
        <StatCard
          label="Absent Today"
          value={absentToday}
          icon={UserX}
          loading={loadingAttendance}
          error={errorAttendance}
          iconBg="bg-red-100 text-red-600"
          subtitle="Marked absent"
          to="/attendance?date=today&status=ABSENT"
        />
        <StatCard
          label="Late Staff Today"
          value={lateToday}
          icon={Timer}
          loading={loadingAttendance}
          error={errorAttendance}
          iconBg="bg-amber-100 text-amber-700"
          subtitle="Marked late"
          to="/attendance?date=today&status=LATE"
        />
        <StatCard
          label="Reliever"
          value={relieverSessions.length}
          icon={Clock}
          loading={loadingRelievers}
          error={errorRelievers}
          iconBg="bg-indigo-100 text-indigo-700"
          subtitle="Sessions today"
          to="/attendance?tab=reliever"
        />
        <StatCard
          label="Pending Leaves"
          value={(leaves ?? []).length}
          icon={Calendar}
          loading={loadingLeaves}
          error={errorLeaves}
          iconBg="bg-yellow-100 text-yellow-700"
          subtitle="Awaiting approval"
          to="/leave?status=PENDING"
        />
        <StatCard
          label="On Leave Today"
          value={onLeaveToday}
          icon={Calendar}
          loading={loadingAttendance}
          error={errorAttendance}
          iconBg="bg-purple-100 text-purple-700"
          subtitle="On approved leave"
          to="/attendance?date=today&status=ON_LEAVE"
        />
        <StatCard
          label="Open Disciplinary Cases"
          value={(disciplinary ?? []).length}
          icon={AlertTriangle}
          loading={loadingDisciplinary}
          error={errorDisciplinary}
          iconBg="bg-orange-100 text-orange-600"
          subtitle="Requires action"
          to="/disciplinary?status=OPEN"
        />
        <StatCard
          label="Pending Job Applications"
          value={(applications ?? []).length}
          icon={UserPlus}
          loading={loadingApplications}
          error={errorApplications}
          iconBg="bg-primary/10 text-primary"
          subtitle="New applicants"
          to="/recruitment?status=APPLIED"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Recent Employees</CardTitle>
            <ViewAllLink to="/employees" />
          </CardHeader>
          <CardContent>
            {loadingEmployees ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : recentEmployees.length === 0 ? (
              <p className="text-sm text-text-secondary">No employees found</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentEmployees.map((emp) => (
                    <TableRow
                      key={emp.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => navigate(`/employees/${emp.id}`)}
                    >
                      <TableCell className="font-medium">{emp.employeeCode}</TableCell>
                      <TableCell>{`${emp.firstName} ${emp.lastName}`}</TableCell>
                      <TableCell>{emp.currentDepartment?.name ?? '—'}</TableCell>
                      <TableCell>{emp.currentBranch?.name ?? '—'}</TableCell>
                      <TableCell>{statusBadge(emp.status)}</TableCell>
                      <TableCell>
                        {format(new Date(emp.joiningDate), 'dd/MM/yyyy')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Recent Leave Requests</CardTitle>
            <ViewAllLink to="/leave" />
          </CardHeader>
          <CardContent>
            {loadingLeaves ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : recentLeaves.length === 0 ? (
              <p className="text-sm text-text-secondary">No pending leave requests</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentLeaves.map((leave) => (
                    <TableRow
                      key={leave.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => navigate('/leave')}
                    >
                      <TableCell>
                        {leave.employee
                          ? `${leave.employee.firstName} ${leave.employee.lastName}`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {format(new Date(leave.startDate), 'dd/MM/yyyy')}
                      </TableCell>
                      <TableCell>
                        {format(new Date(leave.endDate), 'dd/MM/yyyy')}
                      </TableCell>
                      <TableCell>{leave.totalDays}</TableCell>
                      <TableCell>{statusBadge(leave.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
