import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useSearchParams } from 'react-router-dom'
import { attendanceApi } from '@/api/endpoints/attendance'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import {
  EMPTY_EMPLOYEE_FILTERS,
  EmployeeFiltersBar,
  employeeFiltersToAttendanceParams,
} from '@/components/employees/EmployeeFiltersBar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  ATTENDANCE_STATUSES,
  type AttendanceLog,
  type AttendanceStatus,
  type RelieverSession,
} from '@/types'

const ALL = 'ALL'

const statusStyles: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-green-100 text-green-800 border-green-200',
  ABSENT: 'bg-red-100 text-red-800 border-red-200',
  LATE: 'bg-amber-100 text-amber-800 border-amber-200',
  HALF_DAY: 'bg-blue-100 text-blue-800 border-blue-200',
  ON_LEAVE: 'bg-purple-100 text-purple-800 border-purple-200',
  UNINFORMED_ABSENT: 'bg-red-200 text-red-900 border-red-300',
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

function formatTime(value?: string | null) {
  if (!value) return '—'
  return format(new Date(value), 'HH:mm')
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}

function DailyLogTab({ initialStatus = ALL }: { initialStatus?: string }) {
  const queryClient = useQueryClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate] = useState(today)
  const [employeeFilters, setEmployeeFilters] = useState(EMPTY_EMPLOYEE_FILTERS)
  const [statusFilter, setStatusFilter] = useState(initialStatus)
  const [confirmAbsentees, setConfirmAbsentees] = useState(false)

  const queryParams = useMemo(
    () => ({
      startDate: date,
      endDate: date,
      status: statusFilter !== ALL ? statusFilter : undefined,
      ...employeeFiltersToAttendanceParams(employeeFilters),
    }),
    [date, statusFilter, employeeFilters],
  )

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['attendance', queryParams],
    queryFn: () => attendanceApi.getAll(queryParams),
  })

  const attendanceLogs = logs as AttendanceLog[]

  const summary = useMemo(() => {
    const total = attendanceLogs.length
    const present = attendanceLogs.filter((l) => l.status === 'PRESENT').length
    const absent = attendanceLogs.filter((l) => l.status === 'ABSENT').length
    const late = attendanceLogs.filter((l) => l.status === 'LATE').length
    return { total, present, absent, late }
  }, [attendanceLogs])

  const markAbsenteesMutation = useMutation({
    mutationFn: () => attendanceApi.markAbsentees(date),
    onSuccess: () => {
      toast({ title: 'Absentees marked successfully' })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      setConfirmAbsentees(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to mark absentees',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>Date</Label>
            <Input
              type="date"
              className="w-[160px]"
              value={date}
              onChange={(e) => setDate(e.target.value)}
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

        <Button
          className="bg-amber-500 hover:bg-amber-600"
          onClick={() => setConfirmAbsentees(true)}
        >
          Mark Absentees
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-white p-4">
        <EmployeeFiltersBar
          filters={employeeFilters}
          onChange={setEmployeeFilters}
        />
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Employee Name</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Check In</TableHead>
              <TableHead>Check Out</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Late Minutes</TableHead>
              <TableHead>Overtime</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(9)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : attendanceLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-text-secondary">
                  No attendance records for this date
                </TableCell>
              </TableRow>
            ) : (
              attendanceLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-mono text-sm">
                    {log.employee?.employeeCode ?? '—'}
                  </TableCell>
                  <TableCell className="font-medium">
                    {log.employee
                      ? `${log.employee.firstName} ${log.employee.lastName}`
                      : '—'}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {log.branch?.name ?? '—'}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {formatTime(log.checkIn)}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {formatTime(log.checkOut)}
                  </TableCell>
                  <TableCell>
                    <AttendanceStatusBadge status={log.status} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      (log.lateMinutes ?? 0) > 0 && 'font-medium text-red-600',
                    )}
                  >
                    {(log.lateMinutes ?? 0) > 0 ? log.lateMinutes : '—'}
                  </TableCell>
                  <TableCell
                    className={cn(
                      (log.overtimeMinutes ?? 0) > 0 &&
                        'font-medium text-green-600',
                    )}
                  >
                    {(log.overtimeMinutes ?? 0) > 0
                      ? log.overtimeMinutes
                      : '—'}
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {!isLoading && attendanceLogs.length > 0 && (
          <div className="border-t border-border px-4 py-3 text-sm text-text-secondary">
            Total: {summary.total} | Present: {summary.present} | Absent:{' '}
            {summary.absent} | Late: {summary.late}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmAbsentees}
        title="Mark Absentees"
        description={`Mark all employees without attendance on ${format(new Date(date), 'dd/MM/yyyy')} as ABSENT?`}
        confirmLabel="Mark Absent"
        onConfirm={() => markAbsenteesMutation.mutate()}
        onCancel={() => setConfirmAbsentees(false)}
        loading={markAbsenteesMutation.isPending}
      />
    </div>
  )
}

function BulkManualTab({ onSuccess }: { onSuccess: () => void }) {
  const queryClient = useQueryClient()
  const today = format(new Date(), 'yyyy-MM-dd')

  const [branchId, setBranchId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [date, setDate] = useState(today)
  const [roleFilter, setRoleFilter] = useState('ALL')
  const [loaded, setLoaded] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState('')

  type MarkChoice = 'PRESENT' | 'ABSENT' | 'ON_LEAVE' | null
  const [selections, setSelections] = useState<
    Record<string, { status: MarkChoice; isLate: boolean }>
  >({})

  const ROLE_FILTERS = [
    'ALL',
    'DOCTOR',
    'NURSE',
    'ADMIN STAFF',
    'PHARMACIST',
    'TECHNICIAN',
  ]

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', branchId],
    queryFn: () => departmentsApi.getAll({ branchId }),
    enabled: !!branchId,
  })

  const { data: employees = [], refetch: refetchEmployees } = useQuery({
    queryKey: ['bulk-attendance-employees', branchId, departmentId],
    queryFn: () =>
      employeesApi.getAll({
        branchId,
        departmentId: departmentId || undefined,
        status: 'ACTIVE',
      }),
    enabled: false,
  })

  const { data: existingLogs = [] } = useQuery({
    queryKey: ['attendance-bulk', date, branchId],
    queryFn: () =>
      attendanceApi.getAll({
        startDate: date,
        endDate: date,
        branchId,
      }),
    enabled: loaded && !!branchId,
  })

  const filteredEmployees = useMemo(() => {
    if (roleFilter === 'ALL') return employees
    return employees.filter((e) =>
      e.currentDesignation.toUpperCase().includes(roleFilter),
    )
  }, [employees, roleFilter])

  const logByEmployee = useMemo(() => {
    const map = new Map<string, AttendanceLog>()
    for (const log of existingLogs as AttendanceLog[]) {
      if (log.employeeId) map.set(log.employeeId, log)
    }
    return map
  }, [existingLogs])

  const handleLoad = async () => {
    if (!branchId) {
      toast({
        title: 'Branch required',
        description: 'Please select a branch',
        variant: 'destructive',
      })
      return
    }
    await refetchEmployees()
    setSelections({})
    setLoaded(true)
  }

  const setMark = (employeeId: string, status: MarkChoice) => {
    setSelections((prev) => ({
      ...prev,
      [employeeId]: {
        status,
        isLate: status === 'PRESENT' ? (prev[employeeId]?.isLate ?? false) : false,
      },
    }))
  }

  const toggleLate = (employeeId: string) => {
    setSelections((prev) => ({
      ...prev,
      [employeeId]: {
        status: prev[employeeId]?.status ?? 'PRESENT',
        isLate: !prev[employeeId]?.isLate,
      },
    }))
  }

  const handleSaveAll = async () => {
    const toSave = Object.entries(selections).filter(
      ([, v]) => v.status !== null,
    )
    if (toSave.length === 0) {
      toast({
        title: 'Nothing to save',
        description: 'Select attendance status for at least one employee',
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    let saved = 0

    for (const [employeeId, { status, isLate }] of toSave) {
      setProgress(`Saving ${saved + 1}/${toSave.length}...`)
      let finalStatus: AttendanceStatus = status!
      if (status === 'PRESENT' && isLate) finalStatus = 'LATE'

      await attendanceApi.markManual({
        employeeId,
        date,
        status: finalStatus,
        note: note || undefined,
      })
      saved++
    }

    setSaving(false)
    setProgress('')
    toast({ title: `Attendance saved for ${saved} employees` })
    queryClient.invalidateQueries({ queryKey: ['attendance'] })
    setSelections({})
    onSuccess()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-4">
        <div className="space-y-1">
          <Label>Branch *</Label>
          <Select
            value={branchId}
            onValueChange={(v) => {
              setBranchId(v)
              setDepartmentId('')
              setLoaded(false)
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Department</Label>
          <Select
            value={departmentId || 'all'}
            onValueChange={(v) => {
              setDepartmentId(v === 'all' ? '' : v)
              setLoaded(false)
            }}
            disabled={!branchId}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Date</Label>
          <Input
            type="date"
            className="w-[160px]"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              setLoaded(false)
            }}
          />
        </div>

        <div className="space-y-1">
          <Label>Role Filter</Label>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_FILTERS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r === 'ALL' ? 'All Roles' : r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={handleLoad}
          disabled={!branchId}
        >
          Load Employees
        </Button>
      </div>

      {loaded && (
        <>
          <div className="rounded-lg border border-border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Current Status</TableHead>
                  <TableHead>Mark As</TableHead>
                  <TableHead>LATE</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-text-secondary">
                      No employees found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEmployees.map((emp) => {
                    const log = logByEmployee.get(emp.id)
                    const sel = selections[emp.id]
                    return (
                      <TableRow key={emp.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {emp.firstName} {emp.lastName}
                            </p>
                            <p className="font-mono text-xs text-text-secondary">
                              {emp.employeeCode}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-text-secondary">
                          {emp.shift
                            ? `${emp.shift.name} (${emp.shift.startTime}-${emp.shift.endTime})`
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {log ? (
                            <AttendanceStatusBadge status={log.status} />
                          ) : (
                            <span className="text-text-secondary">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {(['PRESENT', 'ABSENT', 'ON_LEAVE'] as const).map(
                              (s) => (
                                <Button
                                  key={s}
                                  size="sm"
                                  variant={
                                    sel?.status === s ? 'default' : 'outline'
                                  }
                                  className={cn(
                                    sel?.status === s &&
                                      'bg-primary hover:bg-primary-dark',
                                  )}
                                  onClick={() => setMark(emp.id, s)}
                                >
                                  {s === 'ON_LEAVE' ? 'Leave' : s.charAt(0) + s.slice(1).toLowerCase()}
                                </Button>
                              ),
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={sel?.isLate ?? false}
                            disabled={sel?.status !== 'PRESENT'}
                            onChange={() => toggleLate(emp.id)}
                            className="h-4 w-4"
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-2">
            <Label>Shared Note (applied to all records)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for all marked attendance..."
            />
          </div>

          <div className="flex items-center gap-4">
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={saving}
              onClick={handleSaveAll}
            >
              {saving ? 'Saving...' : 'Save All'}
            </Button>
            {progress && (
              <span className="text-sm text-text-secondary">{progress}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function RelieverSessionsTab() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate] = useState(today)
  const [employeeFilters, setEmployeeFilters] = useState(EMPTY_EMPLOYEE_FILTERS)

  const queryParams = useMemo(
    () => ({
      startDate: date,
      endDate: date,
      ...employeeFiltersToAttendanceParams(employeeFilters),
    }),
    [date, employeeFilters],
  )

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['reliever-sessions', queryParams],
    queryFn: () => attendanceApi.listRelieverSessions(queryParams),
  })

  const activeCount = (sessions as RelieverSession[]).filter(
    (s) => !s.checkOut,
  ).length

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Date</Label>
        <Input
          type="date"
          className="w-[160px]"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <div className="rounded-lg border border-border bg-white p-4">
        <EmployeeFiltersBar
          filters={employeeFilters}
          onChange={setEmployeeFilters}
        />
      </div>

      <p className="text-sm text-text-secondary">
        {sessions.length} session{sessions.length === 1 ? '' : 's'}
        {activeCount > 0 ? ` · ${activeCount} active` : ''}
      </p>

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
            ) : sessions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-text-secondary"
                >
                  No reliever sessions for this date
                </TableCell>
              </TableRow>
            ) : (
              (sessions as RelieverSession[]).map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="font-medium">
                    {session.employee?.employeeCode ?? '—'}
                  </TableCell>
                  <TableCell>
                    {session.employee
                      ? `${session.employee.firstName} ${session.employee.lastName}`
                      : '—'}
                  </TableCell>
                  <TableCell>{session.branch?.name ?? '—'}</TableCell>
                  <TableCell>{formatTime(session.checkIn)}</TableCell>
                  <TableCell>{formatTime(session.checkOut)}</TableCell>
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
      </div>
    </div>
  )
}

export function AttendancePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'daily'
  const statusParam = searchParams.get('status') || ALL

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
          <DailyLogTab initialStatus={statusParam} />
        </TabsContent>

        <TabsContent value="reliever" className="mt-4">
          <RelieverSessionsTab />
        </TabsContent>

        <TabsContent value="manual" className="mt-4">
          <BulkManualTab
            onSuccess={() => {
              const next = new URLSearchParams(searchParams)
              next.delete('tab')
              setSearchParams(next, { replace: true })
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
