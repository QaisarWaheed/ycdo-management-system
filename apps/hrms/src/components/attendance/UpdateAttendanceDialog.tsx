import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { attendanceApi } from '@/api/endpoints/attendance'
import { employeesApi } from '@/api/endpoints/employees'
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
import { TimeAmpmSelect } from '@/components/common/TimeAmpmSelect'
import { formatDateTimeTime } from '@/lib/timeFormat'
import { ATTENDANCE_STATUSES, type AttendanceLog, type AttendanceStatus } from '@/types'

function isoToTimeInput(value?: string | null): string {
  if (!value) return ''
  return format(new Date(value), 'HH:mm')
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
      setCheckIn(isoToTimeInput(log.checkIn))
      setCheckOut(isoToTimeInput(log.checkOut))
      setLateMinutes(log.lateMinutes ?? 0)
      setOvertimeMinutes(log.overtimeMinutes ?? 0)
      setNote(log.note ?? '')
    }
  }, [open, log])

  useEffect(() => {
    if (!open || !checkIn || !dutyStartTime) return
    const late = calcLateMinutes(checkIn, dutyStartTime)
    setLateMinutes(late)
    if (showsTimeFields(status)) {
      setStatus(statusFromLateMinutes(late))
    }
  }, [checkIn, dutyStartTime, open])

  const mutation = useMutation({
    mutationFn: () => {
      if (!log) throw new Error('No attendance record')
      return attendanceApi.update(log.id, {
        status,
        checkIn:
          checkIn && showsTimeFields(status)
            ? combineDateAndTime(date, checkIn)
            : undefined,
        checkOut:
          checkOut && showsTimeFields(status)
            ? combineDateAndTime(date, checkOut)
            : undefined,
        lateMinutes: lateMinutes === '' ? 0 : Number(lateMinutes),
        overtimeMinutes:
          isSuperAdmin && overtimeMinutes !== ''
            ? Number(overtimeMinutes)
            : undefined,
        note: note || undefined,
      })
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
    ? `${log.employee.fullName}`
    : 'Employee'

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

          <div className="space-y-2">
            <Label>Status</Label>
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

          {showsTimeFields(status) && (
            <div className="grid grid-cols-2 gap-4">
              <TimeAmpmSelect
                label="Check In"
                value={checkIn}
                onChange={setCheckIn}
              />
              <TimeAmpmSelect
                label="Check Out"
                value={checkOut}
                onChange={setCheckOut}
              />
            </div>
          )}

          {showsTimeFields(status) && (
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

          {showsTimeFields(status) && (
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
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
