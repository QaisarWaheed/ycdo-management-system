import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { attendanceApi } from '@/api/endpoints/attendance'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { toast } from '@/hooks/use-toast'
import { getApiErrorMessage } from '@/lib/apiErrorMessage'
import {
  partitionSuspensionWatchlist,
  type WatchEntry,
  type WatchReason,
} from '@/lib/suspensionWatchlist'
import { cn } from '@/lib/utils'

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
  mode,
  busyEmployeeId,
  onSendReminder,
  onStartCase,
}: {
  rows: WatchEntry[]
  loading: boolean
  emptyLabel: string
  mode: 'near' | 'due'
  busyEmployeeId: string | null
  onSendReminder: (employeeId: string) => void
  onStartCase: (employeeId: string) => void
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
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const busy = busyEmployeeId === row.employeeId
          return (
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
                  {row.phone ? (
                    <a
                      href={`tel:${row.phone}`}
                      className="text-xs text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.phone}
                    </a>
                  ) : (
                    <span className="text-xs text-text-secondary">No phone</span>
                  )}
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
              <TableCell className="text-right">
                {mode === 'near' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onSendReminder(row.employeeId)}
                  >
                    {busy ? 'Sending…' : 'Send reminder'}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => onStartCase(row.employeeId)}
                  >
                    {busy ? 'Starting…' : 'Start inquiry'}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export function SuspensionWatchlistPage({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'near' | 'due'>('due')
  const [busyEmployeeId, setBusyEmployeeId] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['suspension-watchlist'],
    queryFn: () => attendanceApi.getSuspensionWatchlist(),
  })

  const reminderMutation = useMutation({
    mutationFn: (employeeId: string) =>
      attendanceApi.sendNearSuspensionReminder(employeeId),
    onMutate: (employeeId) => setBusyEmployeeId(employeeId),
    onSettled: () => setBusyEmployeeId(null),
    onSuccess: () => {
      toast({
        title: 'Reminder sent',
        description: 'Advice letter issued and WhatsApp delivery attempted.',
      })
      queryClient.invalidateQueries({ queryKey: ['letters'] })
      queryClient.invalidateQueries({ queryKey: ['suspension-watchlist'] })
    },
    onError: (err: unknown) => {
      toast({
        title: 'Could not send reminder',
        description: getApiErrorMessage(err, 'Request failed'),
        variant: 'destructive',
      })
    },
  })

  const startCaseMutation = useMutation({
    mutationFn: (employeeId: string) =>
      attendanceApi.startSuspensionCaseFromWatchlist(employeeId),
    onMutate: (employeeId) => setBusyEmployeeId(employeeId),
    onSettled: () => setBusyEmployeeId(null),
    onSuccess: () => {
      toast({
        title: 'Suspension case opened',
        description:
          'Employee moved to Disciplinary. Prepare and submit the suspension letter for approval when ready.',
      })
      queryClient.invalidateQueries({ queryKey: ['suspension-watchlist'] })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
    },
    onError: (err: unknown) => {
      toast({
        title: 'Could not start case',
        description: getApiErrorMessage(err, 'Request failed'),
        variant: 'destructive',
      })
    },
  })

  const { near, due } = useMemo(
    () => partitionSuspensionWatchlist(data),
    [data],
  )
  const monthLabel = useMemo(() => data?.month ?? '—', [data?.month])

  return (
    <div className="space-y-6">
      {!embedded ? (
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">
            Suspension watchlist
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Pakistan calendar month {monthLabel}. Near: send advice reminder.
            Due: open a suspension disciplinary case.
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
          Pakistan calendar month {monthLabel}. Near: Send reminder (letter +
          WhatsApp). Due: Start inquiry opens a suspension case under
          Disciplinary.
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
              {due.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="near" className="gap-2">
            <Clock className="h-4 w-4" />
            Near suspension
            <Badge variant="secondary" className="ml-1">
              {near.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="due"
          className="rounded-lg border bg-white data-[state=inactive]:hidden"
        >
          <WatchlistTable
            rows={due}
            loading={isLoading}
            emptyLabel="No employees due for suspension this month."
            mode="due"
            busyEmployeeId={busyEmployeeId}
            onSendReminder={() => undefined}
            onStartCase={(id) => startCaseMutation.mutate(id)}
          />
        </TabsContent>
        <TabsContent
          value="near"
          className="rounded-lg border bg-white data-[state=inactive]:hidden"
        >
          <WatchlistTable
            rows={near}
            loading={isLoading}
            emptyLabel="No employees near suspension this month."
            mode="near"
            busyEmployeeId={busyEmployeeId}
            onSendReminder={(id) => reminderMutation.mutate(id)}
            onStartCase={() => undefined}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
