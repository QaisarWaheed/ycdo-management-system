import { Scale } from 'lucide-react'
import {
  buildDisciplineTrackRecord,
  disciplineTrackTotal,
} from '@/lib/disciplineTrackRecord'
import { Skeleton } from '@/components/ui/skeleton'
import type { DisciplinaryAction, Letter } from '@/types'

type Props = {
  letters: Letter[]
  actions: DisciplinaryAction[]
  isLoading?: boolean
  currentStatus?: string
}

export function EmployeeDisciplineTrackRecord({
  letters,
  actions,
  isLoading,
  currentStatus,
}: Props) {
  if (isLoading) {
    return (
      <div className="w-full space-y-2 text-left">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  const rows = buildDisciplineTrackRecord(letters, actions)
  const total = disciplineTrackTotal(rows)

  return (
    <div className="w-full rounded-lg border border-border bg-slate-50 p-3 text-left">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
          <Scale className="h-4 w-4 shrink-0" />
          Discipline track record
        </p>
        <span className="text-xs text-text-secondary">{total} issued</span>
      </div>
      {currentStatus === 'SUSPENDED' ||
      currentStatus === 'ON_REST' ||
      currentStatus === 'TERMINATED' ||
      currentStatus === 'DISMISSED' ? (
        <p className="mb-2 text-xs text-text-secondary">
          Current status: {currentStatus.replace(/_/g, ' ')}
        </p>
      ) : null}
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-baseline justify-between gap-2 text-xs"
          >
            <span className="text-text-secondary">{row.label}</span>
            <span
              className={
                row.count > 0
                  ? 'font-semibold tabular-nums text-text-primary'
                  : 'tabular-nums text-text-secondary'
              }
            >
              {row.count}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-text-secondary">
        Counts issued (sent) letters only. Drafts and reversed letters are
        excluded. Open the Disciplinary tab for case detail.
      </p>
    </div>
  )
}
