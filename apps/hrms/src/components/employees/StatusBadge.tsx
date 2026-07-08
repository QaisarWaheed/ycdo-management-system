import { Badge } from '@/components/ui/badge'
import type { EmployeeStatus } from '@/types'
import { cn } from '@/lib/utils'

const statusStyles: Record<EmployeeStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-800 border-green-200',
  TRAINEE: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  APPOINTED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  SUSPENDED: 'bg-amber-100 text-amber-800 border-amber-200',
  TERMINATED: 'bg-red-100 text-red-800 border-red-200',
  RESIGNED: 'bg-gray-100 text-gray-700 border-gray-200',
  ON_LEAVE: 'bg-blue-100 text-blue-800 border-blue-200',
  ON_REST: 'bg-slate-100 text-slate-700 border-slate-300',
  DISMISSED: 'bg-gray-900 text-white border-gray-900',
}

export function StatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const normalized = status === 'APPOINTED' ? 'ACTIVE' : status
  const style =
    statusStyles[normalized as EmployeeStatus] ??
    'bg-gray-100 text-gray-700 border-gray-200'

  const label =
    status === 'DISMISSED'
      ? 'Dismissed'
      : status === 'ON_REST'
        ? 'On Rest'
      : status === 'APPOINTED'
        ? 'Active'
        : status.replace(/_/g, ' ')

  return (
    <Badge variant="outline" className={cn(style, className)}>
      {label}
    </Badge>
  )
}
