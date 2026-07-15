import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AttendanceStatus } from '@/types'

export const attendanceStatusStyles: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-green-100 text-green-800 border-green-200',
  ABSENT: 'bg-red-100 text-red-800 border-red-200',
  UNMARKED: 'bg-slate-100 text-slate-700 border-slate-200',
  LATE: 'bg-amber-100 text-amber-800 border-amber-200',
  HALF_DAY: 'bg-blue-100 text-blue-800 border-blue-200',
  ON_LEAVE: 'bg-purple-100 text-purple-800 border-purple-200',
  UNINFORMED_ABSENT: 'bg-red-200 text-red-900 border-red-300',
  SWAP_COVERED: 'bg-indigo-100 text-indigo-800 border-indigo-200',
}

const statusLabels: Partial<Record<AttendanceStatus, string>> = {
  SWAP_COVERED: 'Swap Covered',
}

function formatStatusLabel(status: string): string {
  return statusLabels[status as AttendanceStatus] ?? status.replace(/_/g, ' ')
}

function swapCoveredTooltip(note?: string | null): string | undefined {
  if (!note) return 'Covered via mutual swap'
  const match = note.match(/covered by (.+)$/i)
  if (match?.[1]) {
    return `Covered by ${match[1]} via mutual swap`
  }
  return note
}

export function AttendanceStatusBadge({
  status,
  note,
  className,
}: {
  status: string
  note?: string | null
  className?: string
}) {
  const style =
    attendanceStatusStyles[status as AttendanceStatus] ??
    'bg-gray-100 text-gray-700 border-gray-200'
  const label = formatStatusLabel(status)
  const title = status === 'SWAP_COVERED' ? swapCoveredTooltip(note) : undefined

  return (
    <Badge
      variant="outline"
      className={cn(style, className)}
      title={title}
    >
      {label}
    </Badge>
  )
}
