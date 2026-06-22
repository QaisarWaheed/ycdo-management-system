import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { attendanceApi } from '@/api/endpoints/attendance'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { ActiveTimer } from '@/types'

interface LiveTimerWidgetProps {
  employeeId: string
  shift?: { startTime: string; endTime: string }
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

function TimerContent({
  timer,
  shift,
  compact,
}: {
  timer: ActiveTimer
  shift?: { startTime: string; endTime: string }
  compact?: boolean
}) {
  const { primaryShift, reliever } = timer
  const primaryActive = primaryShift.isActive
  const shiftComplete =
    primaryShift.checkedIn && !primaryShift.isActive && !!primaryShift.checkOut

  const primaryElapsed = useLiveElapsed(
    primaryShift.checkIn,
    primaryActive,
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

  let statusLabel = 'Not Checked In'
  let statusColor = 'border-gray-200 bg-gray-50 text-gray-600'
  let displayTime = '—'

  if (primaryActive) {
    statusLabel = 'On Duty'
    statusColor = 'border-green-200 bg-green-50 text-green-800'
    displayTime = primaryElapsed
  } else if (shiftComplete) {
    statusLabel = 'Shift Complete'
    statusColor = 'border-blue-200 bg-blue-50 text-blue-800'
    displayTime = fixedDuration
  }

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
            <span className={cn('text-xs opacity-80', compact && 'hidden sm:inline')}>
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
      </div>

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

export function LiveTimerWidget({
  employeeId,
  shift,
  compact,
}: LiveTimerWidgetProps) {
  const { data: timer, isLoading } = useQuery({
    queryKey: ['attendance-timer', employeeId],
    queryFn: () => attendanceApi.getMyTimer(employeeId),
    enabled: !!employeeId,
    refetchInterval: 30_000,
  })

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

  if (compact) {
    return <TimerContent timer={timer} shift={shift} compact />
  }

  return (
    <Card className="border-border shadow-sm">
      <CardContent className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-text-secondary">
          Today&apos;s Timer
        </h3>
        <TimerContent timer={timer} shift={shift} />
      </CardContent>
    </Card>
  )
}
