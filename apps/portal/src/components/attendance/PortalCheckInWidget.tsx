import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, LogIn, LogOut, MapPin } from 'lucide-react'
import { attendanceApi } from '@/api/endpoints/attendance'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/hooks/use-toast'
import { formatDuration } from '@/lib/helpers'
import { parseTimeToMinutes } from '@/lib/shiftUtils'
import { cn } from '@/lib/utils'
import type { ActiveTimer } from '@/types'

interface PortalCheckInWidgetProps {
  employeeId: string
  shift?: { startTime: string; endTime: string; name?: string }
  compact?: boolean
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function useLiveElapsed(startIso: string | null, active: boolean): string {
  const [elapsed, setElapsed] = useState('00:00:00')

  useEffect(() => {
    if (!startIso || !active) {
      setElapsed('00:00:00')
      return
    }

    const start = new Date(startIso).getTime()
    const tick = () => setElapsed(formatElapsed(Date.now() - start))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startIso, active])

  return elapsed
}

function getShiftProgress(
  shift: { startTime: string; endTime: string } | undefined,
  checkInIso: string | null,
  isActive: boolean,
): { percent: number; markerPercent: number } | null {
  if (!shift) return null

  let startMin = parseTimeToMinutes(shift.startTime)
  let endMin = parseTimeToMinutes(shift.endTime)
  if (endMin <= startMin) endMin += 24 * 60

  const shiftDuration = endMin - startMin
  if (shiftDuration <= 0) return null

  const now = new Date()
  let nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
  if (nowMin < startMin && endMin > 24 * 60) nowMin += 24 * 60

  const markerPercent = Math.min(
    100,
    Math.max(0, ((nowMin - startMin) / shiftDuration) * 100),
  )

  let elapsedMin = 0
  if (checkInIso) {
    const checkIn = new Date(checkInIso)
    let checkInMin = checkIn.getHours() * 60 + checkIn.getMinutes()
    if (checkInMin < startMin && endMin > 24 * 60) checkInMin += 24 * 60

    if (isActive) {
      elapsedMin = Math.max(0, nowMin - checkInMin)
    } else {
      elapsedMin = Math.max(0, nowMin - checkInMin)
    }
  }

  const percent = Math.min(100, Math.max(0, (elapsedMin / shiftDuration) * 100))

  return { percent, markerPercent }
}

function requestLocation(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    })
  })
}

function ShiftProgressBar({
  shift,
  checkInIso,
  isActive,
  compact,
}: {
  shift: { startTime: string; endTime: string }
  checkInIso: string | null
  isActive: boolean
  compact?: boolean
}) {
  const progress = getShiftProgress(shift, checkInIso, isActive)
  if (!progress) return null

  return (
    <div className={cn('space-y-1', compact && 'mt-2')}>
      <div className="flex justify-between text-xs opacity-70">
        <span>{shift.startTime}</span>
        <span>{shift.endTime}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-black/10">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-green-500 transition-all duration-1000"
          style={{ width: `${progress.percent}%` }}
        />
        <div
          className="absolute top-0 h-full w-0.5 bg-primary"
          style={{ left: `${progress.markerPercent}%` }}
        />
      </div>
      <p className="text-xs opacity-70">Shift progress</p>
    </div>
  )
}

function WidgetContent({
  timer,
  shift,
  compact,
  onCheckIn,
  onCheckOut,
  onOvertimeCheckIn,
  onOvertimeCheckOut,
  checkingIn,
  checkingOut,
  overtimePunching,
}: {
  timer: ActiveTimer
  shift?: { startTime: string; endTime: string; name?: string }
  compact?: boolean
  onCheckIn: () => void
  onCheckOut: () => void
  onOvertimeCheckIn: () => void
  onOvertimeCheckOut: () => void
  checkingIn: boolean
  checkingOut: boolean
  overtimePunching: boolean
}) {
  const { primaryShift, reliever, overtime } = timer
  const primaryActive = primaryShift.isActive
  const shiftComplete =
    primaryShift.checkedIn && !primaryShift.isActive && !!primaryShift.checkOut
  const otActive = !!overtime?.isActive
  const canOtCheckIn = !!overtime?.canCheckIn
  const canOtCheckOut = !!overtime?.canCheckOut
  const showOtPrompt =
    canOtCheckIn && (!!overtime?.promptPending || shiftComplete)

  const primaryElapsed = useLiveElapsed(
    primaryShift.checkIn,
    primaryActive,
  )

  const overtimeElapsed = useLiveElapsed(
    overtime?.checkIn ?? null,
    otActive,
  )

  const relieverElapsed = useLiveElapsed(
    reliever.checkIn,
    reliever.isActive,
  )

  const fixedDuration =
    primaryShift.checkIn && primaryShift.checkOut
      ? formatElapsed(
          new Date(primaryShift.checkOut).getTime() -
            new Date(primaryShift.checkIn).getTime(),
        )
      : '00:00:00'

  const fixedMinutes =
    primaryShift.checkIn && primaryShift.checkOut
      ? Math.round(
          (new Date(primaryShift.checkOut).getTime() -
            new Date(primaryShift.checkIn).getTime()) /
            60000,
        )
      : 0

  let statusLabel = 'Not Checked In'
  let statusColor = 'border-gray-200 bg-gray-50 text-gray-600'
  let displayTime = '—'

  if (otActive) {
    statusLabel = 'On Overtime'
    statusColor = 'border-amber-200 bg-amber-50 text-amber-900'
    displayTime = overtimeElapsed
  } else if (primaryActive) {
    statusLabel = 'On Duty'
    statusColor = 'border-green-200 bg-green-50 text-green-800'
    displayTime = primaryElapsed
  } else if (shiftComplete) {
    statusLabel = 'Shift Complete'
    statusColor = 'border-blue-200 bg-blue-50 text-blue-800'
    displayTime = fixedDuration
  }

  const canCheckIn = !primaryShift.checkedIn
  const canCheckOut = primaryShift.checkedIn && !primaryShift.checkOut

  return (
    <div className={cn('space-y-3', compact && 'space-y-2')}>
      <div
        className={cn(
          'rounded-lg border-2 p-4 transition-colors',
          statusColor,
          compact && 'p-3',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className={cn('h-5 w-5', compact && 'h-4 w-4')} />
            <span className={cn('font-medium', compact && 'text-sm')}>
              {statusLabel}
            </span>
          </div>
          {shift && (
            <span
              className={cn('text-xs opacity-80', compact && 'hidden sm:inline')}
            >
              Shift {shift.startTime} – {shift.endTime}
            </span>
          )}
        </div>
        <p
          className={cn(
            'mt-2 font-mono text-3xl font-bold tracking-wider',
            compact && 'text-2xl',
          )}
        >
          {displayTime}
        </p>
        {shiftComplete && !otActive && fixedMinutes > 0 && (
          <p className="mt-1 text-sm opacity-80">
            Total: {formatDuration(fixedMinutes)}
          </p>
        )}
        {primaryShift.checkIn && (
          <p className="mt-1 text-xs opacity-70">
            Check-in:{' '}
            {new Date(primaryShift.checkIn).toLocaleTimeString('en-PK', {
              hour: '2-digit',
              minute: '2-digit',
            })}
            {primaryShift.checkOut &&
              ` · Check-out: ${new Date(primaryShift.checkOut).toLocaleTimeString('en-PK', {
                hour: '2-digit',
                minute: '2-digit',
              })}`}
          </p>
        )}
        {overtime?.checkIn && (
          <p className="mt-1 text-xs opacity-70">
            OT in:{' '}
            {new Date(overtime.checkIn).toLocaleTimeString('en-PK', {
              hour: '2-digit',
              minute: '2-digit',
            })}
            {overtime.checkOut &&
              ` · OT out: ${new Date(overtime.checkOut).toLocaleTimeString('en-PK', {
                hour: '2-digit',
                minute: '2-digit',
              })}`}
          </p>
        )}

        {shift && (primaryActive || primaryShift.checkIn) && !otActive && (
          <ShiftProgressBar
            shift={shift}
            checkInIso={primaryShift.checkIn}
            isActive={primaryActive}
            compact={compact}
          />
        )}
      </div>

      {(canCheckIn || canCheckOut) && (
        <div className="flex flex-wrap gap-2">
          {canCheckIn && (
            <Button
              className="bg-green-600 hover:bg-green-700"
              disabled={checkingIn || checkingOut || overtimePunching}
              onClick={onCheckIn}
            >
              <LogIn className="mr-2 h-4 w-4" />
              {checkingIn ? 'Getting location...' : 'Check In'}
            </Button>
          )}
          {canCheckOut && (
            <Button
              variant="destructive"
              disabled={checkingIn || checkingOut || overtimePunching}
              onClick={onCheckOut}
            >
              <LogOut className="mr-2 h-4 w-4" />
              {checkingOut ? 'Getting location...' : 'Check Out'}
            </Button>
          )}
          <p className="flex w-full items-center gap-1 text-xs text-text-secondary">
            <MapPin className="h-3 w-3" />
            Location access required for check-in/out
          </p>
        </div>
      )}

      {(showOtPrompt || canOtCheckOut) && (
        <div
          className={cn(
            'rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-amber-950',
            compact && 'p-3',
          )}
        >
          {showOtPrompt && (
            <>
              <p className={cn('font-medium', compact && 'text-sm')}>
                Your shift has ended
              </p>
              <p className="mt-1 text-sm text-amber-900/80">
                Staying for overtime? Mark your check-in.
              </p>
              <Button
                className="mt-3 bg-amber-700 hover:bg-amber-800"
                disabled={overtimePunching || checkingIn || checkingOut}
                onClick={onOvertimeCheckIn}
              >
                <LogIn className="mr-2 h-4 w-4" />
                {overtimePunching
                  ? 'Recording...'
                  : 'Mark Overtime Check-In'}
              </Button>
            </>
          )}
          {canOtCheckOut && (
            <>
              <p className={cn('font-medium', compact && 'text-sm')}>
                Overtime in progress
              </p>
              <p className="mt-1 text-sm text-amber-900/80">
                Mark check-out when you finish overtime.
              </p>
              <Button
                variant="destructive"
                className="mt-3"
                disabled={overtimePunching || checkingIn || checkingOut}
                onClick={onOvertimeCheckOut}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {overtimePunching
                  ? 'Recording...'
                  : 'Mark Overtime Check-Out'}
              </Button>
            </>
          )}
        </div>
      )}

      {reliever.isActive && (
        <div
          className={cn(
            'rounded-lg border-2 border-orange-200 bg-orange-50 p-3 text-orange-800',
            compact && 'p-2',
          )}
        >
          <div className="flex items-center justify-between">
            <span className={cn('text-sm font-medium', compact && 'text-xs')}>
              Reliever Session Active
            </span>
            <span
              className={cn(
                'font-mono text-xl font-bold',
                compact && 'text-lg',
              )}
            >
              {relieverElapsed}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export function PortalCheckInWidget({
  employeeId,
  shift,
  compact,
}: PortalCheckInWidgetProps) {
  const queryClient = useQueryClient()
  const [checkingIn, setCheckingIn] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [overtimePunching, setOvertimePunching] = useState(false)

  const { data: timer, isLoading } = useQuery({
    queryKey: ['attendance-timer', employeeId],
    queryFn: () => attendanceApi.getMyTimer(employeeId),
    enabled: !!employeeId,
    refetchInterval: 30_000,
  })

  const invalidateAttendance = () => {
    queryClient.invalidateQueries({ queryKey: ['attendance-timer', employeeId] })
    queryClient.invalidateQueries({ queryKey: ['attendance-logs'] })
    queryClient.invalidateQueries({ queryKey: ['attendance-summary'] })
    queryClient.invalidateQueries({ queryKey: ['working-hours'] })
    queryClient.invalidateQueries({ queryKey: ['attendance-today'] })
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  const checkInMutation = useMutation({
    mutationFn: (coords: { latitude: number; longitude: number }) =>
      attendanceApi.portalCheckIn(coords),
    onSuccess: (data) => {
      toast({
        title: 'Check-in recorded',
        description: `Verified within ${data.distance}m of your branch`,
      })
      invalidateAttendance()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Check-in failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
    onSettled: () => setCheckingIn(false),
  })

  const checkOutMutation = useMutation({
    mutationFn: (coords: { latitude: number; longitude: number }) =>
      attendanceApi.portalCheckOut(coords),
    onSuccess: (data) => {
      toast({
        title: 'Check-out recorded',
        description: `You worked ${data.hoursWorked} hours today`,
      })
      invalidateAttendance()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Check-out failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
    onSettled: () => setCheckingOut(false),
  })

  const overtimeMutation = useMutation({
    mutationFn: (punchType: 'OVERTIME_CHECKIN' | 'OVERTIME_CHECKOUT') =>
      attendanceApi.overtimePunch(punchType),
    onSuccess: (_data, punchType) => {
      toast({
        title:
          punchType === 'OVERTIME_CHECKIN'
            ? 'Overtime check-in recorded'
            : 'Overtime check-out recorded',
      })
      invalidateAttendance()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Overtime punch failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
    onSettled: () => setOvertimePunching(false),
  })

  const handleCheckIn = async () => {
    setCheckingIn(true)
    try {
      const pos = await requestLocation()
      checkInMutation.mutate({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      })
    } catch {
      setCheckingIn(false)
      toast({
        title: 'Location access required',
        description: 'Please enable location services to check in',
        variant: 'destructive',
      })
    }
  }

  const handleCheckOut = async () => {
    setCheckingOut(true)
    try {
      const pos = await requestLocation()
      checkOutMutation.mutate({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      })
    } catch {
      setCheckingOut(false)
      toast({
        title: 'Location access required',
        description: 'Please enable location services to check out',
        variant: 'destructive',
      })
    }
  }

  const handleOvertimeCheckIn = () => {
    setOvertimePunching(true)
    overtimeMutation.mutate('OVERTIME_CHECKIN')
  }

  const handleOvertimeCheckOut = () => {
    setOvertimePunching(true)
    overtimeMutation.mutate('OVERTIME_CHECKOUT')
  }

  if (isLoading) {
    return (
      <Card className={cn('border-border', compact && 'shadow-sm')}>
        <CardContent className={cn('p-4', compact && 'p-3')}>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (!timer) return null

  const content = (
    <WidgetContent
      timer={timer}
      shift={shift}
      compact={compact}
      onCheckIn={handleCheckIn}
      onCheckOut={handleCheckOut}
      onOvertimeCheckIn={handleOvertimeCheckIn}
      onOvertimeCheckOut={handleOvertimeCheckOut}
      checkingIn={checkingIn || checkInMutation.isPending}
      checkingOut={checkingOut || checkOutMutation.isPending}
      overtimePunching={overtimePunching || overtimeMutation.isPending}
    />
  )

  if (compact) {
    return content
  }

  return (
    <Card className="border-border shadow-sm">
      <CardContent className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-text-secondary">
          Today&apos;s Attendance
        </h3>
        {content}
      </CardContent>
    </Card>
  )
}
