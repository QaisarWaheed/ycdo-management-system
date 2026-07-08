import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { attendanceApi } from '@/api/endpoints/attendance'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { shiftsApi } from '@/api/endpoints/shifts'
import { TimeInput12Hour } from '@/components/common/TimeInput12Hour'
import { ShiftFilterDropdowns } from '@/components/employees/ShiftFilterDropdowns'
import { Button } from '@/components/ui/button'
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
import { useAuth } from '@/hooks/useAuth'
import {
  calcLateMinutes,
  combineDateAndTime,
  getEmployeeDutyStartTime,
  graceMinutesRemaining,
  isWithinGrace,
  statusFromLateMinutes,
} from '@/lib/attendanceUtils'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import { sortEmployeesByHierarchy } from '@/lib/employeeHierarchy'
import { cn } from '@/lib/utils'
import {
  ALL_SHIFTS_AT_START,
  formatShiftOptionLabel,
  resolveShiftIds,
} from '@/lib/shiftFilterUtils'
import {
  formatDateTimeTime,
  formatDurationSince,
} from '@/lib/timeFormat'
import type { AttendanceLog, Employee } from '@/types'

const REFRESH_MS = 60_000

function currentTime24(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

function filterByShift(
  employees: Employee[],
  shiftIdsParam: string | undefined,
): Employee[] {
  if (!shiftIdsParam) return employees
  const allowed = new Set(shiftIdsParam.split(','))
  return employees.filter((e) => e.shiftId && allowed.has(e.shiftId))
}

type ManualFiltersProps = {
  branchId: string
  departmentId: string
  shiftStartTime: string
  shiftId: string
  onBranchChange: (id: string) => void
  onDepartmentChange: (id: string) => void
  onShiftStartTimeChange: (startTime: string) => void
  onShiftIdChange: (id: string) => void
}

function ManualAttendanceFilters({
  branchId,
  departmentId,
  shiftStartTime,
  shiftId,
  onBranchChange,
  onDepartmentChange,
  onShiftStartTimeChange,
  onShiftIdChange,
}: ManualFiltersProps) {
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

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-4">
      <div className="space-y-1">
        <Label>Branch *</Label>
        <Select
          value={branchId}
          onValueChange={(v) => {
            onBranchChange(v)
            onDepartmentChange('')
            onShiftStartTimeChange('')
            onShiftIdChange('')
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
          onValueChange={(v) => onDepartmentChange(v === 'all' ? '' : v)}
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

      <ShiftFilterDropdowns
        shifts={shifts}
        shiftStartTime={shiftStartTime}
        shiftId={shiftId}
        triggerClassName="w-[180px]"
        onShiftStartTimeChange={(startTime) => {
          onShiftStartTimeChange(startTime)
          onShiftIdChange(startTime ? ALL_SHIFTS_AT_START : '')
        }}
        onShiftIdChange={onShiftIdChange}
      />
    </div>
  )
}

export function CheckInManualTab() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isAdminManager = user?.role === 'ADMIN_MANAGER'
  const today = format(new Date(), 'yyyy-MM-dd')
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const [branchId, setBranchId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [shiftStartTime, setShiftStartTime] = useState('')
  const [shiftId, setShiftId] = useState('')
  const [checkInTimes, setCheckInTimes] = useState<Record<string, string>>({})
  const [markingId, setMarkingId] = useState<string | null>(null)

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts', branchId || 'all'],
    queryFn: () => shiftsApi.getAll(branchId || undefined),
    enabled: !!branchId,
  })

  const shiftIdsParam = resolveShiftIds(shiftStartTime, shiftId, shifts)

  const { data: activeEmployees = [], isLoading } = useQuery({
    queryKey: [
      'active-shift-checkin',
      today,
      branchId,
      departmentId,
      shiftStartTime,
      shiftId,
    ],
    queryFn: () =>
      employeesApi.getActiveShift({
        date: today,
        time: currentTime24(),
        branchId: branchId || undefined,
        departmentId: departmentId || undefined,
      }),
    enabled: !!branchId,
    refetchInterval: REFRESH_MS,
  })

  const employees = useMemo(() => {
    const filtered = filterByShift(activeEmployees, shiftIdsParam)
    return sortEmployeesByHierarchy(filtered)
  }, [activeEmployees, shiftIdsParam])

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
      currentTime24()
    setMarkingId(employee.id)
    markMutation.mutate({ employee, checkIn24 })
  }

  return (
    <div className="space-y-4">
      {isAdminManager && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You can only mark attendance during the 15-minute grace period after
          shift start. Contact HR for late attendance marking.
        </div>
      )}

      <p className="text-sm text-text-secondary">
        Employees on an active shift who have not checked in today. Refreshes
        every 60 seconds.
      </p>

      <ManualAttendanceFilters
        branchId={branchId}
        departmentId={departmentId}
        shiftStartTime={shiftStartTime}
        shiftId={shiftId}
        onBranchChange={setBranchId}
        onDepartmentChange={setDepartmentId}
        onShiftStartTimeChange={setShiftStartTime}
        onShiftIdChange={setShiftId}
      />

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
            {!branchId ? (
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
            ) : employees.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-text-secondary">
                  No employees pending check-in for the current shift
                </TableCell>
              </TableRow>
            ) : (
              employees.map((emp) => {
                const dutyStart =
                  getEmployeeDutyStartTime(emp) || '08:00'
                const withinGrace =
                  !isAdminManager || isWithinGrace(dutyStart)
                const graceRemaining = graceMinutesRemaining(dutyStart)

                return (
                <TableRow
                  key={emp.id}
                  className={cn(
                    isAdminManager &&
                      (withinGrace
                        ? 'bg-green-50/60'
                        : 'bg-muted/40 opacity-60'),
                  )}
                >
                  <TableCell className="font-medium">{emp.fullName}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {emp.employeeCode}
                  </TableCell>
                  <TableCell>{emp.currentDesignation ?? '—'}</TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {emp.shift
                      ? formatShiftOptionLabel(emp.shift)
                      : '—'}
                    {isAdminManager && withinGrace && (
                      <p className="mt-1 text-xs font-medium text-green-700">
                        Grace ends in {graceRemaining} minute
                        {graceRemaining === 1 ? '' : 's'}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <TimeInput12Hour
                      value={checkInTimes[emp.id] ?? currentTime24()}
                      onChange={(v) =>
                        setCheckInTimes((prev) => ({ ...prev, [emp.id]: v }))
                      }
                      disabled={isAdminManager && !withinGrace}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary-dark"
                      disabled={
                        markingId === emp.id ||
                        (isAdminManager && !withinGrace)
                      }
                      title={
                        isAdminManager && !withinGrace
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
      </div>
    </div>
  )
}

export function CheckOutManualTab() {
  const queryClient = useQueryClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const [, setTick] = useState(0)

  const [branchId, setBranchId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [shiftStartTime, setShiftStartTime] = useState('')
  const [shiftId, setShiftId] = useState('')
  const [checkOutTimes, setCheckOutTimes] = useState<Record<string, string>>({})
  const [markingId, setMarkingId] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts', branchId || 'all'],
    queryFn: () => shiftsApi.getAll(branchId || undefined),
    enabled: !!branchId,
  })

  const shiftIdsParam = resolveShiftIds(shiftStartTime, shiftId, shifts)

  const { data: logs = [], isLoading } = useQuery({
    queryKey: [
      'manual-checkout',
      today,
      branchId,
      departmentId,
      shiftStartTime,
      shiftId,
    ],
    queryFn: () =>
      attendanceApi.getAll({
        startDate: today,
        endDate: today,
        branchId: branchId || undefined,
        departmentId: departmentId || undefined,
        shiftIds: shiftIdsParam,
      }),
    enabled: !!branchId,
    refetchInterval: REFRESH_MS,
  })

  const pendingCheckout = useMemo(() => {
    return (logs as AttendanceLog[])
      .filter((log) => log.checkIn && !log.checkOut)
      .sort((a, b) =>
        (a.employee?.fullName ?? '').localeCompare(b.employee?.fullName ?? ''),
      )
  }, [logs])

  const markMutation = useMutation({
    mutationFn: async ({
      log,
      checkOut24,
    }: {
      log: AttendanceLog
      checkOut24: string
    }) => {
      return attendanceApi.update(log.id, {
        checkOut: combineDateAndTime(today, checkOut24),
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
    const checkOut24 = checkOutTimes[log.id] || currentTime24()
    setMarkingId(log.id)
    markMutation.mutate({ log, checkOut24 })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Employees checked in today who have not yet checked out. Refreshes every
        60 seconds.
      </p>

      <ManualAttendanceFilters
        branchId={branchId}
        departmentId={departmentId}
        shiftStartTime={shiftStartTime}
        shiftId={shiftId}
        onBranchChange={setBranchId}
        onDepartmentChange={setDepartmentId}
        onShiftStartTimeChange={setShiftStartTime}
        onShiftIdChange={setShiftId}
      />

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Check In</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Check Out Time</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!branchId ? (
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
            ) : pendingCheckout.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-text-secondary">
                  No employees pending check-out
                </TableCell>
              </TableRow>
            ) : (
              pendingCheckout.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-medium">
                    {log.employee?.fullName ?? '—'}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {log.employee?.employeeCode ?? '—'}
                  </TableCell>
                  <TableCell>{formatDateTimeTime(log.checkIn)}</TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {log.checkIn
                      ? formatDurationSince(log.checkIn)
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <TimeInput12Hour
                      value={checkOutTimes[log.id] ?? currentTime24()}
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
      </div>
    </div>
  )
}
