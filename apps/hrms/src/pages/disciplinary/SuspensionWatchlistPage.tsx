import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { attendanceApi } from '@/api/endpoints/attendance'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

type WatchReason = 'LATE_NEAR' | 'LATE_DUE' | 'UA_NEAR' | 'UA_DUE'

type WatchEntry = {
  employeeId: string
  fullName: string
  employeeCode: string | null
  biometricId: string | null
  branchId: string | null
  branchName: string | null
  lateDays: number
  uninformedAbsentDays: number
  reasons: WatchReason[]
}

function reasonLabel(reason: WatchReason) {
  switch (reason) {
    case 'LATE_NEAR':
      return 'Late 6–8'
    case 'LATE_DUE':
      return 'Late ≥9'
    case 'UA_NEAR':
      return 'UA = 2'
    case 'UA_DUE':
      return 'UA ≥3'
    default:
      return reason
  }
}

function reasonClass(reason: WatchReason) {
  if (reason === 'LATE_DUE' || reason === 'UA_DUE') {
    return 'bg-red-100 text-red-800 border-red-200'
  }
  return 'bg-amber-100 text-amber-800 border-amber-200'
}

function WatchlistTable({
  rows,
  loading,
  emptyLabel,
}: {
  rows: WatchEntry[]
  loading: boolean
  emptyLabel: string
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="p-6 text-sm text-text-secondary">{emptyLabel}</p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Branch</TableHead>
          <TableHead className="text-right">Late days</TableHead>
          <TableHead className="text-right">UA days</TableHead>
          <TableHead>Reasons</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.employeeId}>
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <EmployeeNameLink
                  employee={{
                    id: row.employeeId,
                    fullName: row.fullName,
                    employeeCode: row.employeeCode ?? undefined,
                  }}
                />
                {row.employeeCode ? (
                  <span className="text-xs text-text-secondary">
                    {row.employeeCode}
                    {row.biometricId ? ` · Bio ${row.biometricId}` : ''}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell>{row.branchName ?? '—'}</TableCell>
            <TableCell className="text-right tabular-nums">
              {row.lateDays}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.uninformedAbsentDays}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {row.reasons.map((r) => (
                  <Badge
                    key={r}
                    variant="outline"
                    className={cn('font-normal', reasonClass(r))}
                  >
                    {reasonLabel(r)}
                  </Badge>
                ))}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function SuspensionWatchlistPage({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const [tab, setTab] = useState<'near' | 'due'>('due')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['attendance', 'suspension-watchlist'],
    queryFn: () => attendanceApi.getSuspensionWatchlist(),
  })

  const near = data?.near ?? []
  const due = data?.due ?? []
  const monthLabel = useMemo(() => data?.month ?? '—', [data?.month])

  return (
    <div className="space-y-6">
      {!embedded ? (
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">
            Suspension watchlist
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Pakistan calendar month {monthLabel}. Auto letters and auto
            suspension are off — review and act manually via Disciplinary.
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            <Link
              to="/letters?section=disciplinary"
              className="text-primary underline-offset-2 hover:underline"
            >
              Open disciplinary cases
            </Link>
          </p>
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          Pakistan calendar month {monthLabel}. Open a disciplinary suspension
          case to prepare and send a letter after approval.
        </p>
      )}

      {isError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Could not load the watchlist. Try again or check API access.
        </p>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as 'near' | 'due')}
      >
        <TabsList>
          <TabsTrigger value="due" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Due for suspension
            <Badge variant="secondary" className="ml-1">
              {data?.counts.due ?? due.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="near" className="gap-2">
            <Clock className="h-4 w-4" />
            Near suspension
            <Badge variant="secondary" className="ml-1">
              {data?.counts.near ?? near.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="due" className="rounded-lg border bg-white">
          <WatchlistTable
            rows={due}
            loading={isLoading}
            emptyLabel="No employees due for suspension this month."
          />
        </TabsContent>
        <TabsContent value="near" className="rounded-lg border bg-white">
          <WatchlistTable
            rows={near}
            loading={isLoading}
            emptyLabel="No employees near suspension this month."
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
