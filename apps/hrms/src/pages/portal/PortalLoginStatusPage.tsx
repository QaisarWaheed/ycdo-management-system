import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Monitor } from 'lucide-react'
import {
  portalPresenceApi,
  type PortalPresenceStatus,
} from '@/api/endpoints/portalPresence'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDebounce } from '@/hooks/useDebounce'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import { formatPKT } from '@/lib/timeFormat'
import { cn } from '@/lib/utils'

const STATUS_FILTERS: { value: '' | PortalPresenceStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'LOGGED_IN', label: 'Logged in' },
  { value: 'NEVER_LOGGED_IN', label: 'Never logged in' },
]

function statusBadge(status: PortalPresenceStatus) {
  if (status === 'LOGGED_IN') {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
        Logged in
      </Badge>
    )
  }
  return (
    <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
      Never logged in
    </Badge>
  )
}

function formatLastPortalLogin(value: string | null) {
  if (!value) return 'Never'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'Never'
  const datePart = d.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  return `${datePart} ${formatPKT(value)}`
}

export function PortalLoginStatusPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status') ?? ''
  const initialStatus =
    statusParam === 'LOGGED_IN' || statusParam === 'NEVER_LOGGED_IN'
      ? statusParam
      : ''

  const [status, setStatus] = useState<'' | PortalPresenceStatus>(initialStatus)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  useEffect(() => {
    setStatus(initialStatus)
  }, [initialStatus])

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['portal-presence', 'summary'],
    queryFn: () => portalPresenceApi.getSummary(),
    refetchInterval: 60_000,
  })

  const { data: rows = [], isLoading: loadingRows } = useQuery({
    queryKey: ['portal-presence', status || 'all', debouncedSearch],
    queryFn: () =>
      portalPresenceApi.getAll({
        ...(status ? { status } : {}),
        ...(debouncedSearch.trim()
          ? { search: debouncedSearch.trim() }
          : {}),
      }),
    refetchInterval: 60_000,
  })

  const chips = useMemo(
    () =>
      STATUS_FILTERS.map((f) => ({
        ...f,
        count:
          f.value === ''
            ? summary?.withPortalAccount
            : f.value === 'LOGGED_IN'
              ? summary?.loggedIn
              : summary?.neverLoggedIn,
      })),
    [summary],
  )

  const setStatusFilter = (next: '' | PortalPresenceStatus) => {
    setStatus(next)
    const nextParams = new URLSearchParams(searchParams)
    if (next) nextParams.set('status', next)
    else nextParams.delete('status')
    setSearchParams(nextParams, { replace: true })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
            <Monitor className="h-7 w-7 text-primary" />
            Portal Login
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Employee portal accounts (same set as Login Access → Employee
            Portal). Logged in = at least one successful portal sign-in.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold">{summary?.withPortalAccount ?? '—'}</p>
            <p className="text-sm text-text-secondary">Portal accounts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-emerald-700">
              {summary?.loggedIn ?? '—'}
            </p>
            <p className="text-sm text-text-secondary">Logged in</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold">{summary?.neverLoggedIn ?? '—'}</p>
            <p className="text-sm text-text-secondary">Never logged in</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold">{summary?.active ?? '—'}</p>
            <p className="text-sm text-text-secondary">Active accounts</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => setStatusFilter(chip.value)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
              status === chip.value
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-white text-text-secondary hover:border-primary/40',
            )}
          >
            {chip.label}
            {!loadingSummary && chip.count != null ? (
              <span className="ml-1.5 opacity-80">({chip.count})</span>
            ) : null}
          </button>
        ))}
      </div>

      <Input
        placeholder="Search by name or employee code…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Portal login</TableHead>
                <TableHead>Last login (PKT)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingRows
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : rows.map((row) => (
                    <TableRow key={row.userId}>
                      <TableCell>
                        {row.employee ? (
                          <EmployeeNameLink employee={row.employee} />
                        ) : (
                          row.email
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {row.employee?.employeeCode ?? '—'}
                      </TableCell>
                      <TableCell>
                        {formatBranchLabel(row.employee?.branch)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            row.isActive
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-red-200 bg-red-50 text-red-700'
                          }
                        >
                          {row.isActive ? 'Active' : 'Disabled'}
                        </Badge>
                      </TableCell>
                      <TableCell>{statusBadge(row.status)}</TableCell>
                      <TableCell className="text-sm text-text-secondary">
                        {formatLastPortalLogin(row.lastPortalLogin)}
                      </TableCell>
                    </TableRow>
                  ))}
              {!loadingRows && rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-text-secondary"
                  >
                    No portal accounts match these filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
