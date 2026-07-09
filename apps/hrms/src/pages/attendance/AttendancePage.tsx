import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { attendanceApi } from '@/api/endpoints/attendance'
import { shiftsApi } from '@/api/endpoints/shifts'
import { TablePagination } from '@/components/common/TablePagination'
import { TableRecordCount } from '@/components/common/TableRecordCount'
import { DateInput } from '@/components/common/DateInput'
import { UpdateAttendanceDialog } from '@/components/attendance/UpdateAttendanceDialog'
import {
  CheckInManualTab,
  CheckOutManualTab,
} from '@/components/attendance/ManualAttendanceTabs'
import {
  createEmployeeFilters,
  EmployeeFiltersBar,
  employeeFiltersToAttendanceParams,
} from '@/components/employees/EmployeeFiltersBar'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { formatBranchTableLabel } from '@/lib/formatBranchLabel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { useDebounce } from '@/hooks/useDebounce'
import { usePagination } from '@/hooks/usePagination'
import { getLogLateMinutes } from '@/lib/attendanceUtils'
import { formatShiftOptionLabel } from '@/lib/shiftFilterUtils'
import { formatDateTimeTime, todayPakistan } from '@/lib/timeFormat'
import { cn } from '@/lib/utils'
import {
  ATTENDANCE_STATUSES,
  type AttendanceLog,
  type AttendanceStatus,
  type RelieverSession,
} from '@/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ALL = 'ALL'

const statusStyles: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-green-100 text-green-800 border-green-200',
  ABSENT: 'bg-red-100 text-red-800 border-red-200',
  UNMARKED: 'bg-slate-100 text-slate-700 border-slate-200',
  LATE: 'bg-amber-100 text-amber-800 border-amber-200',
  HALF_DAY: 'bg-blue-100 text-blue-800 border-blue-200',
  ON_LEAVE: 'bg-purple-100 text-purple-800 border-purple-200',
  UNINFORMED_ABSENT: 'bg-red-200 text-red-900 border-red-300',
}

function formatLogShift(log: AttendanceLog): string {
  const shift = log.employee?.shift
  if (!shift?.startTime || !shift?.endTime) return '—'
  return formatShiftOptionLabel(shift)
}

function AttendanceStatusBadge({ status }: { status: string }) {
  const style =
    statusStyles[status as AttendanceStatus] ??
    'bg-gray-100 text-gray-700 border-gray-200'
  return (
    <Badge variant="outline" className={style}>
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}

function DailyLogTab({
  initialStatus = ALL,
  initialDate,
}: {
  initialStatus?: string
  initialDate?: string
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate] = useState(initialDate ?? today)
  const [search, setSearch] = useState('')
  const [employeeFilters, setEmployeeFilters] = useState(() =>
    createEmployeeFilters(user),
  )
  const [statusFilter, setStatusFilter] = useState(initialStatus)
  const [updateLog, setUpdateLog] = useState<AttendanceLog | null>(null)

  const debouncedSearch = useDebounce(search, 400)

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => shiftsApi.getAll(),
  })

  const queryParams = useMemo(
    () => ({
      startDate: date,
      endDate: date,
      status: statusFilter !== ALL ? statusFilter : undefined,
      search: debouncedSearch || undefined,
      ...employeeFiltersToAttendanceParams(employeeFilters, shifts),
    }),
    [date, statusFilter, debouncedSearch, employeeFilters, shifts],
  )

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['attendance', queryParams],
    queryFn: () => attendanceApi.getAll(queryParams),
    refetchInterval: date === todayPakistan() ? 60_000 : false,
  })

  const attendanceLogs = logs as AttendanceLog[]

  const summary = useMemo(() => {
    const total = attendanceLogs.length
    const present = attendanceLogs.filter((l) => l.status === 'PRESENT').length
    const absent = attendanceLogs.filter((l) => l.status === 'ABSENT').length
    const unmarked = attendanceLogs.filter((l) => l.status === 'UNMARKED').length
    const late = attendanceLogs.filter((l) => l.status === 'LATE').length
    const uninformedAbsent = attendanceLogs.filter(
      (l) => l.status === 'UNINFORMED_ABSENT',
    ).length
    const halfDay = attendanceLogs.filter((l) => l.status === 'HALF_DAY').length
    return { total, present, absent, unmarked, late, uninformedAbsent, halfDay }
  }, [attendanceLogs])

  const { page, setPage, totalPages, paginated, total } = usePagination(
    attendanceLogs,
    [queryParams],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>Date</Label>
            <DateInput
              className="w-[160px]"
              value={date}
              onChange={setDate}
            />
          </div>

          <div className="space-y-1">
            <Label>Attendance Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Statuses</SelectItem>
                {ATTENDANCE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-white p-4 space-y-4">
        <div className="relative min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
          <Input
            placeholder="Search by name or employee code..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <EmployeeFiltersBar
          filters={employeeFilters}
          onChange={setEmployeeFilters}
        />
      </div>

      <TableRecordCount
        count={total}
        label="attendance record"
        extra={
          !isLoading && total > 0 ? (
            <p className="text-sm text-text-secondary">
              Present: {summary.present} | Unmarked: {summary.unmarked} | Absent:{' '}
              {summary.absent} | Uninformed Absent: {summary.uninformedAbsent} | Late:{' '}
              {summary.late} | Half Day: {summary.halfDay}
            </p>
          ) : undefined
        }
      />

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Employee Name</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead>Check In</TableHead>
              <TableHead>Check Out</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Late Minutes</TableHead>
              <TableHead>Overtime</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(14)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={14} className="h-32 text-center text-text-secondary">
                  No attendance records for this date
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((log) => {
                const displayLateMinutes = getLogLateMinutes(log)
                return (
                <TableRow key={log.id}>
                  <TableCell className="font-mono text-sm">
                    {log.employee?.employeeCode ?? '—'}
                  </TableCell>
                  <TableCell>
                    <EmployeeNameLink
                      employee={log.employee}
                      employeeId={log.employeeId}
                    />
                  </TableCell>
                  <TableCell>
                    {log.employee?.currentDepartment?.name ?? '—'}
                  </TableCell>
                  <TableCell>
                    {log.employee?.currentDesignation ?? '—'}
                  </TableCell>
                  <TableCell>
                    {log.employee?.phone ? (
                      <a
                        href={`tel:${log.employee.phone}`}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        {log.employee.phone}
                      </a>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {formatBranchTableLabel(log.branch)}
                  </TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {formatLogShift(log)}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {formatDateTimeTime(log.checkIn)}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {formatDateTimeTime(log.checkOut)}
                  </TableCell>
                  <TableCell>
                    <AttendanceStatusBadge status={log.status} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      displayLateMinutes > 0 && 'font-medium text-red-600',
                    )}
                  >
                    {displayLateMinutes > 0 ? displayLateMinutes : '—'}
                  </TableCell>
                  <TableCell
                    className={cn(
                      (log.overtimeMinutes ?? 0) > 0 &&
                        !log.overtimePending &&
                        'font-medium text-green-600',
                    )}
                  >
                    {log.overtimePending ? (
                      <Badge className="border-amber-200 bg-amber-100 text-amber-800">
                        Pending Approval
                      </Badge>
                    ) : (log.overtimeMinutes ?? 0) > 0 ||
                      log.overtimeApprovedBy ? (
                      `${log.overtimeMinutes ?? 0} min`
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    {log.source === 'BIOMETRIC' ? (
                      <Badge className="bg-blue-100 text-blue-800">BIOMETRIC</Badge>
                    ) : (
                      <Badge variant="outline" className="text-gray-600">
                        MANUAL
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setUpdateLog(log)}
                    >
                      Update
                    </Button>
                  </TableCell>
                </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>

        <TablePagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPageChange={setPage}
        />
      </div>

      <UpdateAttendanceDialog
        log={updateLog}
        open={!!updateLog}
        onOpenChange={(open) => {
          if (!open) setUpdateLog(null)
        }}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['attendance'] })
        }}
      />
    </div>
  )
}

function RelieverSessionsTab() {
  const { user } = useAuth()
  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate] = useState(today)
  const [employeeFilters, setEmployeeFilters] = useState(() =>
    createEmployeeFilters(user),
  )

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => shiftsApi.getAll(),
  })

  const queryParams = useMemo(
    () => ({
      startDate: date,
      endDate: date,
      ...employeeFiltersToAttendanceParams(employeeFilters, shifts),
    }),
    [date, employeeFilters, shifts],
  )

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['reliever-sessions', queryParams],
    queryFn: () => attendanceApi.listRelieverSessions(queryParams),
  })

  const relieverSessions = sessions as RelieverSession[]

  const activeCount = relieverSessions.filter((s) => !s.checkOut).length

  const { page, setPage, totalPages, paginated, total } = usePagination(
    relieverSessions,
    [queryParams],
  )

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Date</Label>
        <DateInput
          className="w-[160px]"
          value={date}
          onChange={setDate}
        />
      </div>

      <div className="rounded-lg border border-border bg-white p-4">
        <EmployeeFiltersBar
          filters={employeeFilters}
          onChange={setEmployeeFilters}
        />
      </div>

      <TableRecordCount
        count={total}
        label="session"
        extra={
          activeCount > 0 ? (
            <p className="text-sm text-text-secondary">{activeCount} active</p>
          ) : undefined
        }
      />

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Check In</TableHead>
              <TableHead>Check Out</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(7)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-text-secondary"
                >
                  No reliever sessions for this date
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="font-medium">
                    {session.employee?.employeeCode ?? '—'}
                  </TableCell>
                  <TableCell>
                    <EmployeeNameLink
                      employee={session.employee}
                      employeeId={session.employeeId}
                    />
                  </TableCell>
                  <TableCell>{formatBranchTableLabel(session.branch)}</TableCell>
                  <TableCell>{formatDateTimeTime(session.checkIn)}</TableCell>
                  <TableCell>{formatDateTimeTime(session.checkOut)}</TableCell>
                  <TableCell>
                    {session.checkOut
                      ? formatDuration(session.totalMinutes)
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {!session.checkOut ? (
                      <Badge
                        variant="outline"
                        className="border-indigo-200 bg-indigo-100 text-indigo-800"
                      >
                        Active
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-green-200 bg-green-100 text-green-800"
                      >
                        Completed
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <TablePagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPageChange={setPage}
        />
      </div>
    </div>
  )
}

export function AttendancePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'daily'
  const statusParam = searchParams.get('status') || ALL
  const dateParam = searchParams.get('date')
  const initialDate =
    dateParam === 'today'
      ? format(new Date(), 'yyyy-MM-dd')
      : dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : undefined

  const handleTabChange = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'daily') {
      next.delete('tab')
    } else {
      next.set('tab', value)
    }
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Attendance</h1>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="daily">Daily Log</TabsTrigger>
          <TabsTrigger value="reliever">Reliever</TabsTrigger>
          <TabsTrigger value="manual">Mark Manual</TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="mt-4">
          <DailyLogTab initialStatus={statusParam} initialDate={initialDate} />
        </TabsContent>

        <TabsContent value="reliever" className="mt-4">
          <RelieverSessionsTab />
        </TabsContent>

        <TabsContent value="manual" className="mt-4 space-y-4">
          <Tabs defaultValue="checkin">
            <TabsList>
              <TabsTrigger value="checkin">CheckIn</TabsTrigger>
              <TabsTrigger value="checkout">CheckOut</TabsTrigger>
            </TabsList>
            <TabsContent value="checkin" className="mt-4">
              <CheckInManualTab />
            </TabsContent>
            <TabsContent value="checkout" className="mt-4">
              <CheckOutManualTab />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  )
}
