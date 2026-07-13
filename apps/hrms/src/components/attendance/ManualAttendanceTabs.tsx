import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { attendanceApi } from '@/api/endpoints/attendance'
import { leaveApi } from '@/api/endpoints/leave'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { TablePagination } from '@/components/common/TablePagination'
import { TableRecordCount } from '@/components/common/TableRecordCount'
import { SearchableSelect } from '@/components/common/SearchableSelect'
import { DateInput } from '@/components/common/DateInput'
import { TimeInput12Hour } from '@/components/common/TimeInput12Hour'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
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
import { toast } from '@/hooks/use-toast'
import { usePagination } from '@/hooks/usePagination'
import { getLockedBranchId } from '@/lib/branchScope'
import {
  isMedicineDepartmentName,
  isMedicineManagerRole,
  MEDICINE_DEPARTMENT_NAME,
} from '@/lib/medicineScope'
import { useAuth } from '@/hooks/useAuth'
import {
  calcLateMinutes,
  combineCheckOutDateTime,
  combineDateAndTime,
  filterByDutyStartTime,
  formatEmployeeDutyLabel,
  getEmployeeDutyStartTime,
  getUniqueDutyStartTimes,
  graceMinutesRemaining,
  isWithinGrace,
  statusFromLateMinutes,
} from '@/lib/attendanceUtils'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import { sortEmployeesByHierarchy } from '@/lib/employeeHierarchy'
import { cn } from '@/lib/utils'
import { formatShiftTime } from '@/lib/shiftFilterUtils'
import {
  LEAVE_TYPE_OPTIONS,
  labelToLeaveType,
  leaveTypeToLabel,
} from '@/lib/searchableSelectOptions'
import {
  currentPakistanTime24,
  formatDateTimeTime,
  formatDurationSince,
  formatPakistanDate,
  pakistanDateOffset,
  todayPakistan,
} from '@/lib/timeFormat'
import type { AttendanceLog, Employee } from '@/types'
import { Textarea } from '@/components/ui/textarea'

const REFRESH_MS = 60_000

function matchesNameOrCnicSearch(
  employee:
    | { fullName?: string | null; cnic?: string | null }
    | null
    | undefined,
  query: string,
): boolean {
  const q = query.trim()
  if (!q) return true
  if (!employee) return false

  const qLower = q.toLowerCase()
  const name = (employee.fullName ?? '').toLowerCase()
  if (name.includes(qLower)) return true

  const cnic = employee.cnic ?? ''
  if (cnic.toLowerCase().includes(qLower)) return true

  const qDigits = q.replace(/\D/g, '')
  const cnicDigits = cnic.replace(/\D/g, '')
  return !!(qDigits && cnicDigits.includes(qDigits))
}

function filterLogsByDutyStartTime(
  logs: AttendanceLog[],
  dutyStartTime: string,
): AttendanceLog[] {
  if (!dutyStartTime) return logs
  return logs.filter(
    (log) => getEmployeeDutyStartTime(log.employee ?? {}) === dutyStartTime,
  )
}

type ManualFiltersProps = {
  branchId: string
  departmentId: string
  dutyStartTime: string
  dutyStartOptions: string[]
  searchQuery: string
  lockedBranchId?: string
  medicineOnly?: boolean
  /** When set, shows a duty-date picker (used on Check Out). */
  date?: string
  onDateChange?: (date: string) => void
  dateMax?: string
  onBranchChange: (id: string) => void
  onDepartmentChange: (id: string) => void
  onDutyStartTimeChange: (startTime: string) => void
  onSearchChange: (query: string) => void
}

function ManualAttendanceFilters({
  branchId,
  departmentId,
  dutyStartTime,
  dutyStartOptions,
  searchQuery,
  lockedBranchId,
  medicineOnly,
  date,
  onDateChange,
  dateMax,
  onBranchChange,
  onDepartmentChange,
  onDutyStartTimeChange,
  onSearchChange,
}: ManualFiltersProps) {
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
    enabled: !lockedBranchId,
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll(),
  })

  const visibleDepartments = medicineOnly
    ? departments.filter((d) => isMedicineDepartmentName(d.name))
    : departments

  const branchOptions = branches.map((b) => formatBranchLabel(b))
  const selectedBranchLabel =
    branches.find((b) => b.id === branchId)?.name != null
      ? formatBranchLabel(branches.find((b) => b.id === branchId)!)
      : ''

  const departmentOptions = [
    ...(medicineOnly ? [] : ['All Departments']),
    ...visibleDepartments.map((d) => d.name),
  ]
  const selectedDepartmentLabel = medicineOnly
    ? MEDICINE_DEPARTMENT_NAME
    : departmentId
      ? (visibleDepartments.find((d) => d.id === departmentId)?.name ?? '')
      : 'All Departments'

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-4">
      {onDateChange && (
        <div className="w-[180px] space-y-1">
          <Label>Duty date (optional)</Label>
          <DateInput
            value={date ?? ''}
            onChange={onDateChange}
            max={dateMax}
          />
        </div>
      )}

      {!lockedBranchId && (
        <div className="w-[220px]">
          <SearchableSelect
            label="Branch *"
            options={branchOptions}
            value={selectedBranchLabel}
            onChange={(label) => {
              const branch = branches.find((b) => formatBranchLabel(b) === label)
              if (!branch) return
              onBranchChange(branch.id)
              if (!medicineOnly) onDepartmentChange('')
              onDutyStartTimeChange('')
            }}
            placeholder="Search branch..."
          />
        </div>
      )}

      <div className="w-[240px]">
        {medicineOnly ? (
          <div className="space-y-2">
            <Label>Department</Label>
            <Input value={MEDICINE_DEPARTMENT_NAME} disabled />
          </div>
        ) : (
          <SearchableSelect
            label="Department"
            options={departmentOptions}
            value={selectedDepartmentLabel}
            onChange={(label) => {
              if (label === 'All Departments') {
                onDepartmentChange('')
                return
              }
              const dept = visibleDepartments.find((d) => d.name === label)
              if (dept) onDepartmentChange(dept.id)
            }}
            placeholder="Search department..."
          />
        )}
      </div>

      <div className="space-y-1">
        <Label>Duty Start Time</Label>
        <Select
          value={dutyStartTime || 'all'}
          onValueChange={(v) =>
            onDutyStartTimeChange(v === 'all' ? '' : v)
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Duty Times</SelectItem>
            {dutyStartOptions.map((startTime) => (
              <SelectItem key={startTime} value={startTime}>
                {formatShiftTime(startTime)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label>Search (Name or CNIC)</Label>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-text-secondary" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name or CNIC"
            className="w-[220px] pl-8"
          />
        </div>
      </div>
    </div>
  )
}

export function CheckInManualTab() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const lockedBranchId = getLockedBranchId(user)
  const isAdminManager = user?.role === 'ADMIN_MANAGER'
  const isMedicineManager = isMedicineManagerRole(user?.role)
  const today = todayPakistan()
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const [branchId, setBranchId] = useState(lockedBranchId ?? '')
  const [departmentId, setDepartmentId] = useState('')
  const [dutyStartTime, setDutyStartTime] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [checkInTimes, setCheckInTimes] = useState<Record<string, string>>({})
  const [markingId, setMarkingId] = useState<string | null>(null)

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll(),
    enabled: isMedicineManager,
  })

  const medicineDeptId = useMemo(
    () =>
      departments.find((d) => isMedicineDepartmentName(d.name))?.id ?? '',
    [departments],
  )

  useEffect(() => {
    if (lockedBranchId) {
      setBranchId(lockedBranchId)
    }
  }, [lockedBranchId])

  useEffect(() => {
    if (isMedicineManager && medicineDeptId) {
      setDepartmentId(medicineDeptId)
    }
  }, [isMedicineManager, medicineDeptId])

  const effectiveBranchId = lockedBranchId || branchId
  const effectiveDepartmentId = isMedicineManager
    ? medicineDeptId || departmentId
    : departmentId

  const { data: branchEmployees = [] } = useQuery({
    queryKey: [
      'employees',
      effectiveBranchId,
      'duty-times',
      effectiveDepartmentId,
    ],
    queryFn: () =>
      employeesApi.getAll({
        ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
        ...(effectiveDepartmentId
          ? { departmentId: effectiveDepartmentId }
          : {}),
      }),
    enabled: !!effectiveBranchId,
  })

  const dutyStartOptions = useMemo(
    () => getUniqueDutyStartTimes(branchEmployees),
    [branchEmployees],
  )

  const { data: activeEmployees = [], isLoading } = useQuery({
    queryKey: [
      'active-shift-checkin',
      today,
      effectiveBranchId,
      effectiveDepartmentId,
    ],
    queryFn: () =>
      employeesApi.getActiveShift({
        date: today,
        time: currentPakistanTime24(),
        branchId: effectiveBranchId || undefined,
        departmentId: effectiveDepartmentId || undefined,
      }),
    enabled: !!effectiveBranchId,
    refetchInterval: REFRESH_MS,
  })

  const employees = useMemo(() => {
    const filtered = filterByDutyStartTime(activeEmployees, dutyStartTime).filter(
      (emp) => matchesNameOrCnicSearch(emp, searchQuery),
    )
    return sortEmployeesByHierarchy(filtered)
  }, [activeEmployees, dutyStartTime, searchQuery])

  const filterDeps = [
    effectiveBranchId,
    effectiveDepartmentId,
    dutyStartTime,
    searchQuery,
  ]

  const { page, setPage, totalPages, paginated, total } = usePagination(
    employees,
    filterDeps,
  )

  const graceLockedRole = isAdminManager || isMedicineManager

  const markMutation = useMutation({
    mutationFn: async ({
      employee,
      checkIn24,
    }: {
      employee: Employee
      checkIn24: string
    }) => {
      const dutyStart = getEmployeeDutyStartTime(employee)
      const lateMinutes = calcLateMinutes(checkIn24, dutyStart)
      const status = statusFromLateMinutes(lateMinutes)
      return attendanceApi.markManual({
        employeeId: employee.id,
        date: today,
        status,
        checkIn: combineDateAndTime(today, checkIn24),
        lateMinutes,
      })
    },
    onSuccess: () => {
      toast({ title: 'Check-in marked successfully' })
      queryClient.invalidateQueries({ queryKey: ['active-shift-checkin'] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      queryClient.invalidateQueries({ queryKey: ['manual-checkout'] })
      setMarkingId(null)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to mark check-in',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
      setMarkingId(null)
    },
  })

  const handleMarkCheckIn = (employee: Employee) => {
    const checkIn24 =
      checkInTimes[employee.id] ||
      currentPakistanTime24()
    setMarkingId(employee.id)
    markMutation.mutate({ employee, checkIn24 })
  }

  return (
    <div className="space-y-4">
      {graceLockedRole && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You can only mark attendance during the 15-minute grace period after
          shift start. Contact HR for late attendance marking.
        </div>
      )}

      {isMedicineManager && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          Showing only <strong>{MEDICINE_DEPARTMENT_NAME}</strong> staff for the
          selected branch.
        </div>
      )}

      <p className="text-sm text-text-secondary">
        Employees within their registered duty hours who have not checked in
        today. Refreshes every 60 seconds.
      </p>

      <ManualAttendanceFilters
        branchId={branchId}
        departmentId={effectiveDepartmentId}
        dutyStartTime={dutyStartTime}
        dutyStartOptions={dutyStartOptions}
        searchQuery={searchQuery}
        lockedBranchId={lockedBranchId}
        medicineOnly={isMedicineManager}
        onBranchChange={setBranchId}
        onDepartmentChange={setDepartmentId}
        onDutyStartTimeChange={setDutyStartTime}
        onSearchChange={setSearchQuery}
      />

      <TableRecordCount count={total} label="employee" />

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead>Check In Time</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!effectiveBranchId ? (
              <TableRow>
                <TableCell colSpan={6} className="text-text-secondary">
                  Select a branch to load employees
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              [...Array(4)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(6)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-text-secondary">
                  No employees pending check-in for the current duty hours
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((emp) => {
                const dutyStart =
                  getEmployeeDutyStartTime(emp) || '08:00'
                const withinGrace =
                  !graceLockedRole || isWithinGrace(dutyStart)
                const graceRemaining = graceMinutesRemaining(dutyStart)

                return (
                <TableRow
                  key={emp.id}
                  className={cn(
                    graceLockedRole &&
                      (withinGrace
                        ? 'bg-green-50/60'
                        : 'bg-muted/40 opacity-60'),
                  )}
                >
                  <TableCell>
                    <EmployeeNameLink employee={emp} />
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {emp.employeeCode}
                  </TableCell>
                  <TableCell>{emp.currentDesignation ?? '—'}</TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {formatEmployeeDutyLabel(emp)}
                    {graceLockedRole && withinGrace && (
                      <p className="mt-1 text-xs font-medium text-green-700">
                        Grace ends in {graceRemaining} minute
                        {graceRemaining === 1 ? '' : 's'}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <TimeInput12Hour
                      value={checkInTimes[emp.id] ?? currentPakistanTime24()}
                      onChange={(v) =>
                        setCheckInTimes((prev) => ({ ...prev, [emp.id]: v }))
                      }
                      disabled={graceLockedRole && !withinGrace}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary-dark"
                      disabled={
                        markingId === emp.id ||
                        (graceLockedRole && !withinGrace)
                      }
                      title={
                        graceLockedRole && !withinGrace
                          ? 'Grace period ended. Contact HR.'
                          : undefined
                      }
                      onClick={() => handleMarkCheckIn(emp)}
                    >
                      {markingId === emp.id ? 'Saving...' : 'Mark CheckIn'}
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
    </div>
  )
}

/** How far back to load open check-outs by default. */
const PENDING_CHECKOUT_LOOKBACK_DAYS = 30

export function CheckOutManualTab() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const lockedBranchId = getLockedBranchId(user)
  const isMedicineManager = isMedicineManagerRole(user?.role)
  const today = todayPakistan()
  const lookbackStart = pakistanDateOffset(
    -PENDING_CHECKOUT_LOOKBACK_DAYS,
    today,
  )
  const [, setTick] = useState(0)

  const [dutyDateFilter, setDutyDateFilter] = useState('')
  const [branchId, setBranchId] = useState(lockedBranchId ?? '')
  const [departmentId, setDepartmentId] = useState('')
  const [dutyStartTime, setDutyStartTime] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [checkOutTimes, setCheckOutTimes] = useState<Record<string, string>>({})
  const [markingId, setMarkingId] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (lockedBranchId) {
      setBranchId(lockedBranchId)
    }
  }, [lockedBranchId])

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll(),
    enabled: isMedicineManager,
  })

  const medicineDeptId = useMemo(
    () =>
      departments.find((d) => isMedicineDepartmentName(d.name))?.id ?? '',
    [departments],
  )

  useEffect(() => {
    if (isMedicineManager && medicineDeptId) {
      setDepartmentId(medicineDeptId)
    }
  }, [isMedicineManager, medicineDeptId])

  const effectiveBranchId = lockedBranchId || branchId
  const effectiveDepartmentId = isMedicineManager
    ? medicineDeptId || departmentId
    : departmentId

  const { data: branchEmployees = [] } = useQuery({
    queryKey: [
      'employees',
      effectiveBranchId,
      'duty-times',
      effectiveDepartmentId,
    ],
    queryFn: () =>
      employeesApi.getAll({
        ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
        ...(effectiveDepartmentId
          ? { departmentId: effectiveDepartmentId }
          : {}),
      }),
    enabled: !!effectiveBranchId,
  })

  const dutyStartOptions = useMemo(
    () => getUniqueDutyStartTimes(branchEmployees),
    [branchEmployees],
  )

  const { data: logs = [], isLoading } = useQuery({
    queryKey: [
      'manual-checkout',
      lookbackStart,
      today,
      effectiveBranchId,
      effectiveDepartmentId,
    ],
    queryFn: () =>
      attendanceApi.getAll({
        startDate: lookbackStart,
        endDate: today,
        branchId: effectiveBranchId || undefined,
        departmentId: effectiveDepartmentId || undefined,
      }),
    enabled: !!effectiveBranchId,
    refetchInterval: REFRESH_MS,
  })

  const pendingCheckout = useMemo(() => {
    return filterLogsByDutyStartTime(
      (logs as AttendanceLog[]).filter((log) => {
        if (!log.checkIn || log.checkOut) return false
        if (!dutyDateFilter) return true
        return String(log.date).slice(0, 10) === dutyDateFilter
      }),
      dutyStartTime,
    )
      .filter((log) => matchesNameOrCnicSearch(log.employee, searchQuery))
      .sort((a, b) => {
        const aIn = a.checkIn ? new Date(a.checkIn).getTime() : 0
        const bIn = b.checkIn ? new Date(b.checkIn).getTime() : 0
        if (aIn !== bIn) return aIn - bIn
        return (a.employee?.fullName ?? '').localeCompare(
          b.employee?.fullName ?? '',
        )
      })
  }, [logs, dutyStartTime, searchQuery, dutyDateFilter])

  const filterDeps = [
    effectiveBranchId,
    effectiveDepartmentId,
    dutyStartTime,
    searchQuery,
    dutyDateFilter,
  ]

  const { page, setPage, totalPages, paginated, total } = usePagination(
    pendingCheckout,
    filterDeps,
  )

  const markMutation = useMutation({
    mutationFn: async ({
      log,
      checkOut24,
    }: {
      log: AttendanceLog
      checkOut24: string
    }) => {
      return attendanceApi.update(log.id, {
        checkOut: combineCheckOutDateTime(log.date, log.checkIn, checkOut24),
      })
    },
    onSuccess: () => {
      toast({ title: 'Check-out marked successfully' })
      queryClient.invalidateQueries({ queryKey: ['manual-checkout'] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      setMarkingId(null)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to mark check-out',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
      setMarkingId(null)
    },
  })

  const handleMarkCheckOut = (log: AttendanceLog) => {
    const checkOut24 = checkOutTimes[log.id] || currentPakistanTime24()
    setMarkingId(log.id)
    markMutation.mutate({ log, checkOut24 })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        All employees with an open check-in (last{' '}
        {PENDING_CHECKOUT_LOOKBACK_DAYS} days). Use duty date to narrow the
        list. Refreshes every 60 seconds.
      </p>

      <ManualAttendanceFilters
        branchId={branchId}
        departmentId={effectiveDepartmentId}
        dutyStartTime={dutyStartTime}
        dutyStartOptions={dutyStartOptions}
        searchQuery={searchQuery}
        lockedBranchId={lockedBranchId}
        medicineOnly={isMedicineManager}
        date={dutyDateFilter}
        dateMax={today}
        onDateChange={setDutyDateFilter}
        onBranchChange={setBranchId}
        onDepartmentChange={setDepartmentId}
        onDutyStartTimeChange={setDutyStartTime}
        onSearchChange={setSearchQuery}
      />

      {dutyDateFilter ? (
        <button
          type="button"
          className="text-sm font-medium text-teal-700 hover:underline"
          onClick={() => setDutyDateFilter('')}
        >
          Clear duty date — show all open check-outs
        </button>
      ) : null}

      <TableRecordCount count={total} label="attendance record" />

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Duty Date</TableHead>
              <TableHead>Check In</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Check Out Time</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!effectiveBranchId ? (
              <TableRow>
                <TableCell colSpan={7} className="text-text-secondary">
                  Select a branch to load employees
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              [...Array(4)].map((_, i) => (
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
                <TableCell colSpan={7} className="text-text-secondary">
                  No employees pending check-out
                  {dutyDateFilter
                    ? ` for ${formatPakistanDate(dutyDateFilter)}`
                    : ''}
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>
                    <EmployeeNameLink
                      employee={log.employee}
                      employeeId={log.employeeId}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {log.employee?.employeeCode ?? '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatPakistanDate(log.date)}
                  </TableCell>
                  <TableCell>{formatDateTimeTime(log.checkIn)}</TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {log.checkIn
                      ? formatDurationSince(log.checkIn)
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <TimeInput12Hour
                      value={checkOutTimes[log.id] ?? currentPakistanTime24()}
                      onChange={(v) =>
                        setCheckOutTimes((prev) => ({ ...prev, [log.id]: v }))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary-dark"
                      disabled={markingId === log.id}
                      onClick={() => handleMarkCheckOut(log)}
                    >
                      {markingId === log.id ? 'Saving...' : 'Mark CheckOut'}
                    </Button>
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

export function MarkLeaveManualTab() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const lockedBranchId = getLockedBranchId(user)
  const isMedicineManager = isMedicineManagerRole(user?.role)
  const today = todayPakistan()

  const [branchId, setBranchId] = useState(lockedBranchId ?? '')
  const [departmentId, setDepartmentId] = useState('')
  const [dutyStartTime, setDutyStartTime] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [leaveType, setLeaveType] = useState<
    'REGULAR' | 'SHORT_LEAVE' | 'EMERGENCY'
  >('REGULAR')
  const [reason, setReason] = useState('')
  const [markingId, setMarkingId] = useState<string | null>(null)

  useEffect(() => {
    if (lockedBranchId) setBranchId(lockedBranchId)
  }, [lockedBranchId])

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll(),
    enabled: isMedicineManager,
  })

  const medicineDeptId = useMemo(
    () =>
      departments.find((d) => isMedicineDepartmentName(d.name))?.id ?? '',
    [departments],
  )

  useEffect(() => {
    if (isMedicineManager && medicineDeptId) {
      setDepartmentId(medicineDeptId)
    }
  }, [isMedicineManager, medicineDeptId])

  useEffect(() => {
    if (leaveType === 'SHORT_LEAVE') {
      setEndDate(startDate)
    }
  }, [leaveType, startDate])

  const effectiveBranchId = lockedBranchId || branchId
  const effectiveDepartmentId = isMedicineManager
    ? medicineDeptId || departmentId
    : departmentId

  const { data: branchEmployees = [], isLoading } = useQuery({
    queryKey: [
      'employees',
      effectiveBranchId,
      'manual-leave',
      effectiveDepartmentId,
    ],
    queryFn: () =>
      employeesApi.getAll({
        ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
        ...(effectiveDepartmentId
          ? { departmentId: effectiveDepartmentId }
          : {}),
        status: 'ACTIVE',
      }),
    enabled: !!effectiveBranchId,
  })

  const dutyStartOptions = useMemo(
    () => getUniqueDutyStartTimes(branchEmployees),
    [branchEmployees],
  )

  const employees = useMemo(() => {
    const filtered = filterByDutyStartTime(
      branchEmployees as Employee[],
      dutyStartTime,
    ).filter((emp) => matchesNameOrCnicSearch(emp, searchQuery))
    return sortEmployeesByHierarchy(filtered)
  }, [branchEmployees, dutyStartTime, searchQuery])

  const filterDeps = [
    effectiveBranchId,
    effectiveDepartmentId,
    dutyStartTime,
    searchQuery,
  ]

  const { page, setPage, totalPages, paginated, total } = usePagination(
    employees,
    filterDeps,
  )

  const markMutation = useMutation({
    mutationFn: (employeeId: string) =>
      leaveApi.markVerified({
        employeeId,
        startDate,
        endDate: leaveType === 'SHORT_LEAVE' ? startDate : endDate,
        leaveType,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast({
        title: 'Leave marked and approved',
        description: 'No further approval is required.',
      })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      queryClient.invalidateQueries({ queryKey: ['leave'] })
      queryClient.invalidateQueries({ queryKey: ['active-shift-checkin'] })
      setMarkingId(null)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to mark leave',
        description: Array.isArray(msg)
          ? msg.join(', ')
          : String(msg ?? 'Error'),
        variant: 'destructive',
      })
      setMarkingId(null)
    },
  })

  const canSubmit = !!startDate && !!endDate && reason.trim().length >= 3

  const handleMarkLeave = (employeeId: string) => {
    if (!canSubmit) {
      toast({
        title: 'Missing details',
        description: 'Set leave dates and a reason (at least 3 characters).',
        variant: 'destructive',
      })
      return
    }
    setMarkingId(employeeId)
    markMutation.mutate(employeeId)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Mark leave for an employee. Records created here are already verified
        and approved — attendance is updated immediately (no approval
        workflow).
      </p>

      <ManualAttendanceFilters
        branchId={branchId}
        departmentId={effectiveDepartmentId}
        dutyStartTime={dutyStartTime}
        dutyStartOptions={dutyStartOptions}
        searchQuery={searchQuery}
        lockedBranchId={lockedBranchId}
        medicineOnly={isMedicineManager}
        onBranchChange={setBranchId}
        onDepartmentChange={setDepartmentId}
        onDutyStartTimeChange={setDutyStartTime}
        onSearchChange={setSearchQuery}
      />

      <div className="grid gap-4 rounded-lg border border-border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label>Leave type</Label>
          <SearchableSelect
            options={LEAVE_TYPE_OPTIONS}
            value={leaveTypeToLabel(leaveType)}
            onChange={(label) =>
              setLeaveType(
                labelToLeaveType(label) as
                  | 'REGULAR'
                  | 'SHORT_LEAVE'
                  | 'EMERGENCY',
              )
            }
            placeholder="Select leave type..."
          />
        </div>
        <div className="space-y-1">
          <Label>Start date *</Label>
          <DateInput value={startDate} onChange={setStartDate} />
        </div>
        <div className="space-y-1">
          <Label>End date *</Label>
          <DateInput
            value={leaveType === 'SHORT_LEAVE' ? startDate : endDate}
            onChange={setEndDate}
            disabled={leaveType === 'SHORT_LEAVE'}
          />
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-4">
          <Label>Reason *</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Verified leave reason..."
            rows={2}
          />
        </div>
      </div>

      <TableRecordCount count={total} label="employee" />

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Duty</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!effectiveBranchId ? (
              <TableRow>
                <TableCell colSpan={5} className="text-text-secondary">
                  Select a branch to load employees
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              [...Array(4)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(5)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-text-secondary">
                  No employees found
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((emp) => (
                <TableRow key={emp.id}>
                  <TableCell>
                    <EmployeeNameLink employee={emp} employeeId={emp.id} />
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {emp.employeeCode ?? '—'}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {emp.currentDesignation ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {formatEmployeeDutyLabel(emp)}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary-dark"
                      disabled={
                        markingId === emp.id ||
                        !canSubmit ||
                        markMutation.isPending
                      }
                      onClick={() => handleMarkLeave(emp.id)}
                    >
                      {markingId === emp.id ? 'Saving...' : 'Mark Leave'}
                    </Button>
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
