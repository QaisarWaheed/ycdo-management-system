import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  AlertTriangle,
  Calendar,
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
  iconBg,
  to,
}: {
  label: string
  value: number | string
  icon: React.ElementType
  subtitle?: string
  loading?: boolean
  iconBg: string
  to?: string
}) {
  const navigate = useNavigate()

  return (
    <Card
      className={cn(
        'border-border shadow-sm',
        to && 'cursor-pointer transition-shadow hover:shadow-md',
      )}
      role={to ? 'button' : undefined}
      tabIndex={to ? 0 : undefined}
      onClick={to ? () => navigate(to) : undefined}
      onKeyDown={
        to
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                navigate(to)
              }
            }
          : undefined
      }
    >
      <CardContent className="flex items-center gap-4 p-6">
        <div className={`flex h-12 w-12 items-center justify-center rounded-full ${iconBg}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          {loading ? (
            <Skeleton className="mb-2 h-8 w-16" />
          ) : (
            <p className="text-3xl font-bold text-text-primary">{value}</p>
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

export function DashboardPage() {
  const today = todayRange()

  const { data: employees, isLoading: loadingEmployees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.getAll(),
  })

  const { data: attendance, isLoading: loadingAttendance } = useQuery({
    queryKey: ['attendance', 'today', today],
    queryFn: () => attendanceApi.getAll(today),
  })

  const { data: leaves, isLoading: loadingLeaves } = useQuery({
    queryKey: ['leave', 'pending'],
    queryFn: () => leaveApi.getAll({ status: 'PENDING' }),
  })

  const { data: disciplinary, isLoading: loadingDisciplinary } = useQuery({
    queryKey: ['disciplinary', 'open'],
    queryFn: () => disciplinaryApi.getAll({ status: 'OPEN' }),
  })

  const { data: applications, isLoading: loadingApplications } = useQuery({
    queryKey: ['recruitment', 'applied'],
    queryFn: () => recruitmentApi.getAll({ status: 'APPLIED' }),
  })

  const { data: relieverSessions = [], isLoading: loadingRelievers } = useQuery({
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

  const recentEmployees = ((employees ?? []) as Employee[]).slice(0, 5)
  const recentLeaves = ((leaves ?? []) as LeaveRecord[]).slice(0, 5)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Total Employees"
          value={(employees ?? []).length}
          icon={Users}
          loading={loadingEmployees}
          iconBg="bg-primary/10 text-primary"
          subtitle="Active workforce"
        />
        <StatCard
          label="Present Today"
          value={presentToday}
          icon={Clock}
          loading={loadingAttendance}
          iconBg="bg-accent/10 text-accent-dark"
          subtitle={format(new Date(), 'dd MMM yyyy')}
        />
        <StatCard
          label="Absent Today"
          value={absentToday}
          icon={UserX}
          loading={loadingAttendance}
          iconBg="bg-red-100 text-red-600"
          subtitle="Marked absent"
        />
        <StatCard
          label="Late Staff Today"
          value={lateToday}
          icon={Timer}
          loading={loadingAttendance}
          iconBg="bg-amber-100 text-amber-700"
          subtitle="Marked late"
          to="/attendance?status=LATE"
        />
        <StatCard
          label="Reliever"
          value={relieverSessions.length}
          icon={Clock}
          loading={loadingRelievers}
          iconBg="bg-indigo-100 text-indigo-700"
          subtitle="Sessions today"
          to="/attendance?tab=reliever"
        />
        <StatCard
          label="Pending Leaves"
          value={(leaves ?? []).length}
          icon={Calendar}
          loading={loadingLeaves}
          iconBg="bg-yellow-100 text-yellow-700"
          subtitle="Awaiting approval"
        />
        <StatCard
          label="Open Disciplinary Cases"
          value={(disciplinary ?? []).length}
          icon={AlertTriangle}
          loading={loadingDisciplinary}
          iconBg="bg-orange-100 text-orange-600"
          subtitle="Requires action"
        />
        <StatCard
          label="Pending Job Applications"
          value={(applications ?? []).length}
          icon={UserPlus}
          loading={loadingApplications}
          iconBg="bg-primary/10 text-primary"
          subtitle="New applicants"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Employees</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingEmployees ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
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
                    <TableRow key={emp.id}>
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
          <CardHeader>
            <CardTitle className="text-lg">Recent Leave Requests</CardTitle>
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
                    <TableRow key={leave.id}>
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
