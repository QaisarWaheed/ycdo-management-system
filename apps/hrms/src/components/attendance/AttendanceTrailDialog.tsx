import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { History, Loader2 } from 'lucide-react'
import { attendanceApi } from '@/api/endpoints/attendance'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatDateTimeTime } from '@/lib/timeFormat'
import type { AttendanceLog } from '@/types'

type TrailEvent = {
  id: string
  action: string
  createdAt: string
  changes: {
    previous?: Record<string, unknown>
    updated?: Record<string, unknown>
  } | null
  actor: {
    id: string
    email: string
    role: string
    name: string | null
  }
}

function formatValue(key: string, value: unknown): string {
  if (value == null || value === '') return '—'
  if (
    (key === 'checkIn' || key === 'checkOut') &&
    typeof value === 'string'
  ) {
    try {
      return formatDateTimeTime(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function actionLabel(action: string): string {
  switch (action) {
    case 'ATTENDANCE_UPDATED':
      return 'Attendance updated'
    case 'MANUAL_ATTENDANCE':
    case 'ATTENDANCE_MARKED':
      return 'Attendance marked'
    default:
      return action.replace(/_/g, ' ').toLowerCase()
  }
}

export function AttendanceTrailDialog({
  log,
  open,
  onOpenChange,
}: {
  log: AttendanceLog | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['attendance', 'trail', log?.id],
    queryFn: () => attendanceApi.getTrail(log!.id),
    enabled: open && !!log?.id,
  })

  const events = (data?.events ?? []) as TrailEvent[]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Attendance trail
          </DialogTitle>
          <DialogDescription>
            {log
              ? `${format(new Date(log.date), 'dd/MM/yyyy')} · ${data?.attendance?.employeeName ?? 'Employee'}`
              : 'Change history for this attendance row'}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-text-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading trail…
          </div>
        ) : isError ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {(error as Error)?.message || 'Failed to load attendance trail'}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <div>
                <span className="text-text-secondary">Current: </span>
                {data?.attendance?.status ?? log?.status ?? '—'}
              </div>
              <div>
                <span className="text-text-secondary">Check-in: </span>
                {data?.attendance?.checkIn
                  ? formatDateTimeTime(data.attendance.checkIn)
                  : '—'}
                {' · '}
                <span className="text-text-secondary">Check-out: </span>
                {data?.attendance?.checkOut
                  ? formatDateTimeTime(data.attendance.checkOut)
                  : '—'}
              </div>
              <div>
                <span className="text-text-secondary">Source: </span>
                {data?.attendance?.source ?? log?.source ?? '—'}
                {' · '}
                <span className="text-text-secondary">Created: </span>
                {data?.attendance?.createdAt
                  ? format(
                      new Date(data.attendance.createdAt),
                      'dd/MM/yyyy HH:mm',
                    )
                  : '—'}
              </div>
            </div>

            {events.length === 0 ? (
              <p className="text-sm text-text-secondary">
                No audited changes for this row yet. Biometric/system writes may
                not appear here until someone updates the record in HRMS.
              </p>
            ) : (
              <ol className="space-y-3">
                {events.map((event) => {
                  const prev = event.changes?.previous ?? {}
                  const next = event.changes?.updated ?? {}
                  const keys = Array.from(
                    new Set([...Object.keys(prev), ...Object.keys(next)]),
                  ).filter((key) =>
                    [
                      'status',
                      'checkIn',
                      'checkOut',
                      'lateMinutes',
                      'overtimeMinutes',
                      'note',
                      'source',
                    ].includes(key),
                  )
                  return (
                    <li
                      key={event.id}
                      className="rounded-md border border-slate-200 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium">
                          {actionLabel(event.action)}
                        </p>
                        <p className="text-xs text-text-secondary">
                          {format(
                            new Date(event.createdAt),
                            'dd/MM/yyyy HH:mm:ss',
                          )}
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-text-secondary">
                        By{' '}
                        {event.actor.name ||
                          event.actor.email ||
                          event.actor.id}{' '}
                        ({event.actor.role})
                      </p>
                      {keys.length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm">
                          {keys.map((key) => (
                            <li key={key}>
                              <span className="text-text-secondary">{key}: </span>
                              {formatValue(key, prev[key])}
                              {' → '}
                              <span className="font-medium">
                                {formatValue(key, next[key])}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
