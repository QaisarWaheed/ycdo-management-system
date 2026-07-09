import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { attendanceApi } from '@/api/endpoints/attendance'
import { employeesApi } from '@/api/endpoints/employees'
import { TimeInput12Hour } from '@/components/common/TimeInput12Hour'
import { SearchableSelect } from '@/components/common/SearchableSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import {
  calcLateMinutes,
  combineDateAndTime,
  getEmployeeDutyStartTime,
  showsTimeFields,
  statusFromLateMinutes,
} from '@/lib/attendanceUtils'
import {
  enumValueToLabel,
  labelToEnumValue,
} from '@/lib/searchableSelectOptions'
import { formatDateTimeTime } from '@/lib/timeFormat'
import { cn } from '@/lib/utils'
import { ATTENDANCE_STATUSES, type AttendanceLog, type AttendanceStatus } from '@/types'

function isoToTimeInput(value?: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const statusStyles: Record<string, string> = {
  PRESENT: 'bg-green-100 text-green-800 border-green-200',
  LATE: 'bg-amber-100 text-amber-800 border-amber-200',
  HALF_DAY: 'bg-blue-100 text-blue-800 border-blue-200',
  UNMARKED: 'bg-slate-100 text-slate-700 border-slate-200',
}

function isPendingAttendanceStatus(status: string) {
  return (
    status === 'UNMARKED' ||
    status === 'ABSENT' ||
    status === 'UNINFORMED_ABSENT'
  )
}

type UpdateAttendanceDialogProps = {
  log: AttendanceLog | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function UpdateAttendanceDialog({
  log,
  open,
  onOpenChange,
  onSuccess,
}: UpdateAttendanceDialogProps) {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [status, setStatus] = useState<AttendanceStatus>('PRESENT')
  const [statusOverride, setStatusOverride] = useState(false)
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [lateMinutes, setLateMinutes] = useState<number | ''>('')
  const [overtimeMinutes, setOvertimeMinutes] = useState<number | ''>('')
  const [note, setNote] = useState('')

  const employeeId = log?.employeeId ?? ''
  const date = log?.date?.slice(0, 10) ?? ''

  const { data: employeeDetail } = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => employeesApi.getOne(employeeId),
    enabled: open && !!employeeId,
  })

  const dutyStartTime = employeeDetail
    ? getEmployeeDutyStartTime(employeeDetail)
    : ''

  useEffect(() => {
    if (open && log) {
      setStatus(log.status as AttendanceStatus)
      setStatusOverride(false)
      setCheckIn(isoToTimeInput(log.checkIn))
      setCheckOut(isoToTimeInput(log.checkOut))
      setLateMinutes(log.lateMinutes ?? 0)
      setOvertimeMinutes(log.overtimeMinutes ?? 0)
      setNote(log.note ?? '')
    }
  }, [open, log])

  useEffect(() => {
    if (!open || !checkIn || !dutyStartTime || statusOverride) return
    const late = calcLateMinutes(checkIn, dutyStartTime)
    setLateMinutes(late)
    setStatus(statusFromLateMinutes(late))
  }, [checkIn, dutyStartTime, open, statusOverride])

  const mutation = useMutation({
    mutationFn: () => {
      if (!log) throw new Error('No attendance record')

      const payload: Record<string, unknown> = {
        note: note || undefined,
      }

      if (checkIn) {
        payload.checkIn = combineDateAndTime(date, checkIn)
      }

      if (checkOut) {
        payload.checkOut = combineDateAndTime(date, checkOut)
      }

      if (statusOverride) {
        payload.status = status
        payload.lateMinutes = lateMinutes === '' ? 0 : Number(lateMinutes)
      }

      if (isSuperAdmin && overtimeMinutes !== '') {
        payload.overtimeMinutes = Number(overtimeMinutes)
      }

      return attendanceApi.update(log.id, payload)
    },
    onSuccess: () => {
      toast({ title: 'Attendance updated' })
      onSuccess()
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to update attendance',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  if (!log) return null

  const employeeName = log.employee
    ? log.employee.fullName
    : 'Employee'

  const calculatedLate =
    checkIn && dutyStartTime ? calcLateMinutes(checkIn, dutyStartTime) : 0
  const displayStatus = statusOverride
    ? status
    : checkIn && dutyStartTime
      ? statusFromLateMinutes(calculatedLate)
      : status
  const displayLate = statusOverride
    ? lateMinutes === ''
      ? 0
      : Number(lateMinutes)
    : calculatedLate

  const showCheckOut = checkIn || showsTimeFields(displayStatus)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Update Attendance — {employeeName} —{' '}
            {format(new Date(date), 'dd/MM/yyyy')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface p-3 text-sm space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-text-secondary">Current Status:</span>
              <Badge variant="outline">{log.status.replace(/_/g, ' ')}</Badge>
            </div>
            <p>
              <span className="text-text-secondary">Current Check In: </span>
              {formatDateTimeTime(log.checkIn)}
            </p>
            <p>
              <span className="text-text-secondary">Current Check Out: </span>
              {formatDateTimeTime(log.checkOut)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Check In</Label>
              <TimeInput12Hour value={checkIn} onChange={setCheckIn} />
              {isPendingAttendanceStatus(log.status) && !checkIn && (
                <p className="text-xs text-text-secondary">
                  Enter check-in time to mark attendance.
                </p>
              )}
            </div>
            {showCheckOut && (
              <div className="space-y-2">
                <Label>Check Out</Label>
                <TimeInput12Hour value={checkOut} onChange={setCheckOut} />
              </div>
            )}
          </div>

          {checkIn && dutyStartTime && (
            <div className="space-y-2">
              <Label>Calculated Status</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(statusStyles[displayStatus] ?? '')}
                >
                  Status: {displayStatus.replace(/_/g, ' ')}
                  {displayLate > 0 ? ` (${displayLate} minutes)` : ''}
                </Badge>
                {!statusOverride ? (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-sm"
                    onClick={() => setStatusOverride(true)}
                  >
                    Override Status
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-sm"
                    onClick={() => {
                      setStatusOverride(false)
                      const late = calcLateMinutes(checkIn, dutyStartTime)
                      setLateMinutes(late)
                      setStatus(statusFromLateMinutes(late))
                    }}
                  >
                    Use Auto Status
                  </Button>
                )}
              </div>
            </div>
          )}

          {statusOverride && (
            <div className="space-y-2">
              <Label>Override Status</Label>
              <SearchableSelect
                options={ATTENDANCE_STATUSES.map(enumValueToLabel)}
                value={enumValueToLabel(status)}
                onChange={(label) =>
                  setStatus(
                    labelToEnumValue(label, ATTENDANCE_STATUSES) as AttendanceStatus,
                  )
                }
                placeholder="Select status"
              />
            </div>
          )}

          {statusOverride && showsTimeFields(status) && (
            <div className="space-y-2">
              <Label>Late Minutes</Label>
              <Input
                type="number"
                min={0}
                value={lateMinutes}
                onChange={(e) =>
                  setLateMinutes(
                    e.target.value === '' ? '' : Number(e.target.value),
                  )
                }
              />
            </div>
          )}

          {showCheckOut && (
            <div className="space-y-2">
              <Label>Overtime (minutes)</Label>
              <Input
                type="number"
                min={0}
                value={overtimeMinutes}
                disabled={!isSuperAdmin}
                onChange={(e) =>
                  setOvertimeMinutes(
                    e.target.value === '' ? '' : Number(e.target.value),
                  )
                }
              />
              {!isSuperAdmin && (
                <p className="text-xs text-text-secondary">
                  Only Super Admin can update overtime minutes
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Note</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={mutation.isPending || !checkIn}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
