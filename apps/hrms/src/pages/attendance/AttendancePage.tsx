import { useMemo, useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useSearchParams } from 'react-router-dom'
import { attendanceApi } from '@/api/endpoints/attendance'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { shiftsApi } from '@/api/endpoints/shifts'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
import {
  EMPTY_EMPLOYEE_FILTERS,
  EmployeeFiltersBar,
  employeeFiltersToAttendanceParams,
} from '@/components/employees/EmployeeFiltersBar'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
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
import { useAuth } from '@/hooks/useAuth'
import {
  calcLateMinutes,
  calcOvertimeMinutes,
  combineDateAndTime,
  getEmployeeDutyStartTime,
  showsTimeFields,
  statusFromLateMinutes,
} from '@/lib/attendanceUtils'
import {
  getShiftIdsForStartTime,
  getUniqueShiftStartTimes,
  shiftStartTimeFilterLabel,
} from '@/lib/shiftFilterUtils'
import { cn } from '@/lib/utils'
import {
  ATTENDANCE_STATUSES,
  type AttendanceLog,
  type AttendanceStatus,
  type Employee,
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

function DailyLogTab({
  initialStatus = ALL,
  initialDate,
}: {
  initialStatus?: string
  initialDate?: string
}) {
  const queryClient = useQueryClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate] = useState(initialDate ?? today)
  const [employeeFilters, setEmployeeFilters] = useState(EMPTY_EMPLOYEE_FILTERS)
  const [statusFilter, setStatusFilter] = useState(initialStatus)
  const [confirmAbsentees, setConfirmAbsentees] = useState(false)

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts', employeeFilters.branchId || 'all'],
    queryFn: () =>
      shiftsApi.getAll(employeeFilters.branchId || undefined),
  })

  const queryParams = useMemo(
    () => ({
      startDate: date,
      endDate: date,
      status: statusFilter !== ALL ? statusFilter : undefined,
      ...employeeFiltersToAttendanceParams(employeeFilters, shifts),
    }),
    [date, statusFilter, employeeFilters, shifts],
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
                    {formatBranchLabel(log.branch)}
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

function SingleManualTab() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const today = format(new Date(), 'yyyy-MM-dd')

  const [employeeId, setEmployeeId] = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(
    null,
  )
  const [date, setDate] = useState(today)
  const [status, setStatus] = useState<AttendanceStatus>('PRESENT')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [overtimeMinutes, setOvertimeMinutes] = useState<number | ''>('')
  const [note, setNote] = useState('')

  const { data: employeeDetail } = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => employeesApi.getOne(employeeId),
    enabled: !!employeeId,
  })

  const shift = employeeDetail?.shift ?? selectedEmployee?.shift

  const dutyStartTime = employeeDetail
    ? getEmployeeDutyStartTime(employeeDetail)
    : selectedEmployee
      ? getEmployeeDutyStartTime(selectedEmployee)
      : ''

  const calculatedLate = useMemo(() => {
    if (!checkIn || !dutyStartTime) return 0
    return calcLateMinutes(checkIn, dutyStartTime)
  }, [checkIn, dutyStartTime])

  useEffect(() => {
    if (checkIn && dutyStartTime) {
      setStatus(statusFromLateMinutes(calculatedLate))
    }
  }, [checkIn, dutyStartTime, calculatedLate])

  const calculatedOvertime = useMemo(() => {
    if (!checkOut || !shift?.endTime) return 0
    return calcOvertimeMinutes(checkOut, shift.endTime)
  }, [checkOut, shift?.endTime])

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!employeeId) throw new Error('Employee required')
      return attendanceApi.markManual({
        employeeId,
        date,
        status,
        checkIn:
          checkIn && showsTimeFields(status)
            ? combineDateAndTime(date, checkIn)
            : undefined,
        checkOut:
          checkOut && showsTimeFields(status)
            ? combineDateAndTime(date, checkOut)
            : undefined,
        lateMinutes: calculatedLate,
        overtimeMinutes:
          isSuperAdmin && overtimeMinutes !== ''
            ? Number(overtimeMinutes)
            : calculatedOvertime,
        note: note || undefined,
      })
    },
    onSuccess: () => {
      toast({ title: 'Attendance saved successfully' })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      setEmployeeId('')
      setSelectedEmployee(null)
      setStatus('PRESENT')
      setCheckIn('')
      setCheckOut('')
      setOvertimeMinutes('')
      setNote('')
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to save attendance',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <div className="mx-auto max-w-xl space-y-6 rounded-lg border border-border bg-white p-6">
      <h2 className="text-lg font-semibold">Mark Manual Attendance</h2>

      <EmployeeSearchSelect
        label="Employee *"
        value={employeeId}
        onChange={(id, emp) => {
          setEmployeeId(id)
          setSelectedEmployee(emp ?? null)
        }}
      />

      {selectedEmployee && (
        <p className="text-sm text-text-secondary">
          Shift:{' '}
          {shift
            ? `${shift.name} (${shift.startTime} - ${shift.endTime})`
            : 'Not assigned'}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Date *</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Status *</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as AttendanceStatus)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ATTENDANCE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {showsTimeFields(status) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Check In Time</Label>
            <Input
              type="time"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Check Out Time</Label>
            <Input
              type="time"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
            />
          </div>
        </div>
      )}

      {showsTimeFields(status) && (
        <div className="space-y-1">
          <Label>Late Minutes</Label>
          <Input
            type="number"
            readOnly
            value={calculatedLate}
            className="bg-muted"
          />
          {calculatedLate > 0 && (
            <p className="text-sm text-amber-600">
              {calculatedLate > 60
                ? 'More than 1 hour late — marked as Half Day'
                : `${calculatedLate} minutes late`}
            </p>
          )}
          {calculatedLate === 0 && checkIn && dutyStartTime && (
            <p className="text-sm text-green-600">On time</p>
          )}
        </div>
      )}

      {showsTimeFields(status) && (
        <div className="space-y-1">
          <Label>Overtime (minutes)</Label>
          <Input
            type="number"
            min={0}
            value={isSuperAdmin ? overtimeMinutes : calculatedOvertime}
            disabled={!isSuperAdmin}
            title={
              !isSuperAdmin ? 'Overtime must be approved by Admin' : undefined
            }
            onChange={(e) =>
              setOvertimeMinutes(
                e.target.value === '' ? '' : Number(e.target.value),
              )
            }
            className={cn(!isSuperAdmin && 'bg-muted')}
          />
          {!isSuperAdmin && calculatedOvertime > 0 && (
            <p className="text-xs text-text-secondary">
              Calculated: {calculatedOvertime} min — Overtime must be approved
              by Admin
            </p>
          )}
          {isSuperAdmin && calculatedOvertime > 0 && (
            <p className="text-xs text-text-secondary">
              Auto-calculated: {calculatedOvertime} min
            </p>
          )}
        </div>
      )}

      <div className="space-y-1">
        <Label>Note</Label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note..."
        />
      </div>

      <Button
        className="bg-primary hover:bg-primary-dark"
        disabled={!employeeId || saveMutation.isPending}
        onClick={() => saveMutation.mutate()}
      >
        {saveMutation.isPending ? 'Saving...' : 'Save Attendance'}
      </Button>
    </div>
  )
}

type BulkRowState = {
  status: AttendanceStatus | null
  checkIn: string
  checkOut: string
  note: string
}

function BulkManualTab({ onSuccess }: { onSuccess: () => void }) {
  const queryClient = useQueryClient()
  const today = format(new Date(), 'yyyy-MM-dd')

  const [branchId, setBranchId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [shiftStartTime, setShiftStartTime] = useState('')
  const [date, setDate] = useState(today)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState('')
  const [rows, setRows] = useState<Record<string, BulkRowState>>({})

  const BULK_STATUSES: { value: AttendanceStatus; label: string }[] = [
    { value: 'PRESENT', label: 'Present' },
    { value: 'ABSENT', label: 'Absent' },
    { value: 'LATE', label: 'Late' },
    { value: 'ON_LEAVE', label: 'Leave' },
    { value: 'HALF_DAY', label: 'Short Leave' },
  ]

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', branchId || 'all'],
    queryFn: () =>
      departmentsApi.getAll(branchId ? { branchId } : undefined),
  })

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts', branchId || 'all'],
    queryFn: () => shiftsApi.getAll(branchId || undefined),
  })

  const uniqueStartTimes = useMemo(
    () => getUniqueShiftStartTimes(shifts),
    [shifts],
  )

  const shiftIdsParam = shiftStartTime
    ? getShiftIdsForStartTime(shifts, shiftStartTime) || undefined
    : undefined

  const { data: employees = [], refetch: refetchEmployees } = useQuery({
    queryKey: [
      'bulk-attendance-employees',
      branchId,
      departmentId,
      shiftStartTime,
    ],
    queryFn: () =>
      employeesApi.getAll({
        branchId,
        departmentId: departmentId || undefined,
        shiftIds: shiftIdsParam,
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
    setRows({})
    setLoaded(true)
  }

  const updateRow = (
    employeeId: string,
    patch: Partial<BulkRowState>,
  ) => {
    setRows((prev) => ({
      ...prev,
      [employeeId]: {
        status: prev[employeeId]?.status ?? null,
        checkIn: prev[employeeId]?.checkIn ?? '',
        checkOut: prev[employeeId]?.checkOut ?? '',
        note: prev[employeeId]?.note ?? '',
        ...patch,
      },
    }))
  }

  const handleSaveAll = async () => {
    const toSave = Object.entries(rows).filter(([, v]) => v.status !== null)
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

    for (const [employeeId, row] of toSave) {
      setProgress(`Saving ${saved + 1}/${toSave.length}...`)
      const emp = employees.find((e) => e.id === employeeId)
      const dutyStart = getEmployeeDutyStartTime(emp ?? {})
      const status = row.status!
      const lateMinutes =
        row.checkIn && dutyStart
          ? calcLateMinutes(row.checkIn, dutyStart)
          : 0
      const overtimeMinutes =
        row.checkOut && emp?.shift?.endTime
          ? calcOvertimeMinutes(row.checkOut, emp.shift.endTime)
          : 0

      await attendanceApi.markManual({
        employeeId,
        date,
        status,
        checkIn:
          row.checkIn && showsTimeFields(status)
            ? combineDateAndTime(date, row.checkIn)
            : undefined,
        checkOut:
          row.checkOut && showsTimeFields(status)
            ? combineDateAndTime(date, row.checkOut)
            : undefined,
        lateMinutes,
        overtimeMinutes,
        note: row.note || undefined,
      })
      saved++
    }

    setSaving(false)
    setProgress('')
    toast({ title: `Attendance saved for ${saved} employees` })
    queryClient.invalidateQueries({ queryKey: ['attendance'] })
    setRows({})
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
              setShiftStartTime('')
              setLoaded(false)
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {formatBranchLabel(b)}
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
          <Label>Shift</Label>
          <Select
            value={shiftStartTime || 'all'}
            onValueChange={(v) => {
              setShiftStartTime(v === 'all' ? '' : v)
              setLoaded(false)
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Shifts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Shifts</SelectItem>
              {uniqueStartTimes.map((startTime) => (
                <SelectItem key={startTime} value={startTime}>
                  {shiftStartTimeFilterLabel(startTime)}
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
          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Mark As</TableHead>
                  <TableHead>Check In</TableHead>
                  <TableHead>Check Out</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-text-secondary">
                      No employees found
                    </TableCell>
                  </TableRow>
                ) : (
                  employees.map((emp) => {
                    const log = logByEmployee.get(emp.id)
                    const row = rows[emp.id]
                    const showTimes =
                      row?.status && showsTimeFields(row.status)
                    const dutyStart = getEmployeeDutyStartTime(emp)
                    const rowLate =
                      row?.checkIn && dutyStart
                        ? calcLateMinutes(row.checkIn, dutyStart)
                        : 0
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
                            <p className="text-xs text-text-secondary">
                              {emp.currentDesignation}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-text-secondary">
                          {emp.shift
                            ? `${emp.shift.name} (${emp.shift.startTime} - ${emp.shift.endTime})`
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
                          <div className="flex flex-wrap gap-1">
                            {BULK_STATUSES.map((s) => (
                              <Button
                                key={s.value}
                                size="sm"
                                variant={
                                  row?.status === s.value
                                    ? 'default'
                                    : 'outline'
                                }
                                className={cn(
                                  row?.status === s.value &&
                                    'bg-primary hover:bg-primary-dark',
                                )}
                                onClick={() =>
                                  updateRow(emp.id, { status: s.value })
                                }
                              >
                                {s.label}
                              </Button>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="time"
                            className="w-[120px]"
                            disabled={!showTimes}
                            value={row?.checkIn ?? ''}
                            onChange={(e) => {
                              const checkIn = e.target.value
                              const late = checkIn && dutyStart
                                ? calcLateMinutes(checkIn, dutyStart)
                                : 0
                              updateRow(emp.id, {
                                checkIn,
                                status: checkIn
                                  ? statusFromLateMinutes(late)
                                  : row?.status ?? null,
                              })
                            }}
                          />
                          {showTimes && rowLate > 0 && (
                            <p className="mt-1 text-xs text-amber-600">
                              {rowLate > 60
                                ? 'More than 1 hour late'
                                : `${rowLate} min late`}
                            </p>
                          )}
                          {showTimes &&
                            rowLate === 0 &&
                            row?.checkIn &&
                            dutyStart && (
                              <p className="mt-1 text-xs text-green-600">
                                On time
                              </p>
                            )}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="time"
                            className="w-[120px]"
                            disabled={!showTimes}
                            value={row?.checkOut ?? ''}
                            onChange={(e) =>
                              updateRow(emp.id, { checkOut: e.target.value })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="min-w-[140px]"
                            placeholder="Note"
                            value={row?.note ?? ''}
                            onChange={(e) =>
                              updateRow(emp.id, { note: e.target.value })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
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

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts', employeeFilters.branchId || 'all'],
    queryFn: () =>
      shiftsApi.getAll(employeeFilters.branchId || undefined),
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
                  <TableCell>{formatBranchLabel(session.branch)}</TableCell>
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
          <Tabs defaultValue="single">
            <TabsList>
              <TabsTrigger value="single">Single Entry</TabsTrigger>
              <TabsTrigger value="bulk">Bulk Mark</TabsTrigger>
            </TabsList>
            <TabsContent value="single" className="mt-4">
              <SingleManualTab />
            </TabsContent>
            <TabsContent value="bulk" className="mt-4">
              <BulkManualTab
                onSuccess={() => {
                  const next = new URLSearchParams(searchParams)
                  next.delete('tab')
                  setSearchParams(next, { replace: true })
                }}
              />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  )
}
