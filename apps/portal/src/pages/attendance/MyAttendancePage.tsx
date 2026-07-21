import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { attendanceApi } from '@/api/endpoints/attendance'
import { employeesApi } from '@/api/endpoints/employees'
import { PortalCheckInWidget } from '@/components/attendance/PortalCheckInWidget'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/useAuth'
import { calcHoursWorked, formatDuration } from '@/lib/helpers'
import { formatDateTimeTime } from '@/lib/timeFormat'
import type { AttendanceLog, RelieverSession } from '@/types'

function AttendanceStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PRESENT: 'bg-green-100 text-green-800 border-green-200',
    ABSENT: 'bg-red-100 text-red-800 border-red-200',
    LATE: 'bg-amber-100 text-amber-800 border-amber-200',
    HALF_DAY: 'bg-orange-100 text-orange-800 border-orange-200',
    ON_LEAVE: 'bg-blue-100 text-blue-800 border-blue-200',
    UNINFORMED_ABSENT: 'bg-red-100 text-red-800 border-red-200',
  }
  return (
    <Badge variant="outline" className={styles[status] ?? ''}>
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent?: string
}) {
  return (
    <Card className="border-border shadow-sm">
      <CardContent className="p-4 text-center">
        <p className={`text-2xl font-bold ${accent ?? 'text-text-primary'}`}>
          {value}
        </p>
        <p className="text-xs text-text-secondary">{label}</p>
      </CardContent>
    </Card>
  )
}

export function MyAttendancePage() {
  const { user } = useAuth()
  const employeeId = user?.employeeId ?? ''
  const now = new Date()
  const [monthYear, setMonthYear] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i)

  const { data: employee } = useQuery({
    queryKey: ['employee-attendance', employeeId],
    queryFn: () => employeesApi.getOne(employeeId),
    enabled: !!employeeId,
  })

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['attendance-summary', employeeId, monthYear.month, monthYear.year],
    queryFn: () =>
      attendanceApi.getMySummary(employeeId, monthYear.month, monthYear.year),
    enabled: !!employeeId,
  })

  const { data: logs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['attendance-logs', monthYear],
    queryFn: () =>
      attendanceApi.getMy({
        month: monthYear.month,
        year: monthYear.year,
      }),
    enabled: !!employeeId,
  })

  const { data: reliever, isLoading: loadingReliever } = useQuery({
    queryKey: ['reliever-sessions', employeeId, monthYear],
    queryFn: () =>
      attendanceApi.getMyReliever(employeeId, {
        month: monthYear.month,
        year: monthYear.year,
      }),
    enabled: !!employeeId,
  })

  const { data: workingHours, isLoading: loadingWorkingHours } = useQuery({
    queryKey: ['working-hours', employeeId],
    queryFn: () => employeesApi.getWorkingHours(employeeId),
    enabled: !!employeeId,
  })

  const sortedLogs = useMemo(
    () =>
      [...(logs as AttendanceLog[])].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      ),
    [logs],
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">My Attendance</h1>
        <p className="text-sm text-text-secondary">
          Track your daily attendance and reliever sessions
        </p>
      </div>

      {loadingWorkingHours ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <Card className="border-border bg-gradient-to-r from-primary/5 to-accent/5 shadow-sm">
          <CardContent className="p-6">
            <p className="mb-4 text-sm font-semibold text-text-secondary">
              Total Working Hours
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-text-secondary">This Month</p>
                <p className="text-2xl font-bold text-primary">
                  {workingHours?.thisMonthHours ?? 0} hrs
                </p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">All Time</p>
                <p className="text-2xl font-bold text-text-primary">
                  {workingHours?.totalHours ?? 0} hrs
                </p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Average Daily</p>
                <p className="text-2xl font-bold text-accent-dark">
                  {workingHours?.averageDailyHours ?? 0} hrs
                </p>
              </div>
            </div>
            {(workingHours?.anomalies ?? 0) > 0 && (
              <p className="mt-3 text-sm text-amber-700">
                {workingHours?.anomalies} day
                {(workingHours?.anomalies ?? 0) === 1 ? '' : 's'} excluded due to
                invalid punch times
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {employeeId && (
        <PortalCheckInWidget
          employeeId={employeeId}
          shift={employee?.shift ?? undefined}
          compact
        />
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-text-secondary">Month</Label>
          <Select
            value={String(monthYear.month)}
            onValueChange={(m) =>
              setMonthYear((prev) => ({ ...prev, month: Number(m) }))
            }
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {format(new Date(2000, m - 1, 1), 'MMMM')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-text-secondary">Year</Label>
          <Select
            value={String(monthYear.year)}
            onValueChange={(y) =>
              setMonthYear((prev) => ({ ...prev, year: Number(y) }))
            }
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loadingSummary ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <SummaryCard label="Present" value={summary?.present ?? 0} accent="text-accent-dark" />
          <SummaryCard label="Absent" value={summary?.absent ?? 0} accent="text-red-600" />
          <SummaryCard label="Late" value={summary?.late ?? 0} accent="text-amber-600" />
          <SummaryCard label="Half Day" value={summary?.halfDay ?? 0} />
          <SummaryCard label="On Leave" value={summary?.onLeave ?? 0} accent="text-blue-600" />
          <SummaryCard
            label="OT Minutes"
            value={summary?.overtimeMinutes ?? 0}
          />
        </div>
      )}

      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="log">Attendance Log</TabsTrigger>
          <TabsTrigger value="reliever">Reliever Sessions</TabsTrigger>
        </TabsList>

        <TabsContent value="log" className="mt-4">
          <div className="rounded-lg border border-border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Check In</TableHead>
                  <TableHead>Check Out</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Late</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingLogs ? (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={i}>
                      {[...Array(6)].map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : sortedLogs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-text-secondary"
                    >
                      No attendance records for this period
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        {format(new Date(log.date), 'dd/MM/yyyy')}
                      </TableCell>
                      <TableCell>
                        {formatDateTimeTime(log.checkIn)}
                      </TableCell>
                      <TableCell>
                        {formatDateTimeTime(log.checkOut)}
                      </TableCell>
                      <TableCell>
                        {calcHoursWorked(log.checkIn, log.checkOut)}
                      </TableCell>
                      <TableCell>
                        <AttendanceStatusBadge status={log.status} />
                      </TableCell>
                      <TableCell>
                        {log.lateMinutes ? `${log.lateMinutes} min` : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="reliever" className="mt-4">
          <div className="mb-4 rounded-lg border border-border bg-surface p-4">
            <p className="text-sm text-text-secondary">Total Reliever Hours</p>
            <p className="text-2xl font-bold text-primary">
              {loadingReliever
                ? '—'
                : `${reliever?.totalHours ?? 0} hrs (${formatDuration(reliever?.totalMinutes ?? 0)})`}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Check In</TableHead>
                  <TableHead>Check Out</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingReliever ? (
                  [...Array(3)].map((_, i) => (
                    <TableRow key={i}>
                      {[...Array(4)].map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (reliever?.sessions ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-text-secondary"
                    >
                      No reliever sessions this month
                    </TableCell>
                  </TableRow>
                ) : (
                  (reliever?.sessions as RelieverSession[]).map((session) => (
                    <TableRow key={session.id}>
                      <TableCell>
                        {format(new Date(session.date), 'dd/MM/yyyy')}
                      </TableCell>
                      <TableCell>
                        {formatDateTimeTime(session.checkIn)}
                      </TableCell>
                      <TableCell>
                        {session.checkOut
                          ? formatDateTimeTime(session.checkOut)
                          : 'Active'}
                      </TableCell>
                      <TableCell>
                        {formatDuration(session.totalMinutes)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
