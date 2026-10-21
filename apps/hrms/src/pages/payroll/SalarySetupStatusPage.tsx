import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import api from '@/api/axios'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type State = 'VERIFIED' | 'UPDATED' | 'NOT_STARTED' | 'NO_PACKAGE'
interface StatusRow {
  employeeId: string
  employeeCode: string
  fullName: string
  designation: string | null
  branch: string | null
  status: string
  basicStipend: number | null
  lumpsumTotal: number | null
  state: State
  verifiedAt: string | null
  pendingApproval: boolean
  lastChange: { type: string; at: string; by: string } | null
}
interface StatusResponse {
  summary: {
    total: number
    verified: number
    updated: number
    notStarted: number
    noPackage: number
    pendingApproval: number
  }
  rows: StatusRow[]
}

const STATE_LABEL: Record<State, string> = {
  VERIFIED: 'Verified',
  UPDATED: 'Updated, not verified',
  NOT_STARTED: 'Not started',
  NO_PACKAGE: 'No package',
}
const STATE_STYLE: Record<State, string> = {
  VERIFIED: 'bg-green-100 text-green-800',
  UPDATED: 'bg-blue-100 text-blue-800',
  NOT_STARTED: 'bg-amber-100 text-amber-800',
  NO_PACKAGE: 'bg-red-100 text-red-800',
}
type Filter = State | 'ALL' | 'PENDING_APPROVAL'
const words = (st: string) => st.charAt(0) + st.slice(1).toLowerCase().replace(/_/g, ' ')
const pkr = (n: number | null) => (n == null ? '—' : `PKR ${Math.round(n).toLocaleString('en-PK')}`)

/** Finance progress on setting and verifying every employee's salary package. */
export function SalarySetupStatusPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['salary-setup-status'],
    queryFn: () => api.get<unknown, StatusResponse>('/payroll/stipend/status'),
  })
  const [filter, setFilter] = useState<Filter>('ALL')
  const [search, setSearch] = useState('')
  const [branch, setBranch] = useState('')
  const [status, setStatus] = useState('')

  const branches = useMemo(
    () => [...new Set((data?.rows ?? []).map((r) => r.branch).filter(Boolean) as string[])].sort(),
    [data],
  )
  const statuses = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.status))].sort(), [data])
  // Branch and employee status narrow the boxes too, so their counts match the list.
  const scoped = useMemo(
    () => (data?.rows ?? []).filter((r) => (!branch || r.branch === branch) && (!status || r.status === status)),
    [data, branch, status],
  )
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scoped.filter(
      (r) =>
        (filter === 'ALL' ||
          (filter === 'PENDING_APPROVAL' ? r.pendingApproval : r.state === filter)) &&
        (!q || r.fullName.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q)),
    )
  }, [scoped, filter, search])

  const count = (st: State) => scoped.filter((r) => r.state === st).length
  const s = data
    ? {
        total: scoped.length,
        verified: count('VERIFIED'),
        updated: count('UPDATED'),
        notStarted: count('NOT_STARTED'),
        noPackage: count('NO_PACKAGE'),
        pendingApproval: scoped.filter((r) => r.pendingApproval).length,
      }
    : undefined
  const done = s && s.total ? Math.round((s.verified / s.total) * 100) : 0
  const tiles: Array<{ key: Filter; label: string; value?: number; style: string }> = [
    { key: 'ALL', label: 'All staff', value: s?.total, style: 'border-border' },
    { key: 'VERIFIED', label: 'Verified', value: s?.verified, style: 'border-green-300' },
    { key: 'UPDATED', label: 'Updated, not verified', value: s?.updated, style: 'border-blue-300' },
    { key: 'NOT_STARTED', label: 'Not started', value: s?.notStarted, style: 'border-amber-300' },
    { key: 'NO_PACKAGE', label: 'No package', value: s?.noPackage, style: 'border-red-300' },
    { key: 'PENDING_APPROVAL', label: 'Waiting for approval', value: s?.pendingApproval, style: 'border-purple-300' },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Salary Setup Status</h1>
        <p className="text-sm text-text-secondary">
          {s ? `${s.verified} of ${s.total} salary packages verified (${done}%).` : 'Loading…'} Click a box to see
          those employees; open an employee to edit and verify the package.
        </p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-200">
          <div className="h-full bg-green-600" style={{ width: `${done}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(t.key)}
            className={`rounded-lg border-2 bg-white p-3 text-left ${t.style} ${
              filter === t.key ? 'ring-2 ring-primary' : ''
            }`}
          >
            <div className="text-2xl font-semibold">{t.value ?? '—'}</div>
            <div className="text-xs text-text-secondary">{t.label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search name or code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded-md border border-border bg-white px-3 text-sm"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        >
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-border bg-white px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {statuses.map((st) => (
            <option key={st} value={st}>
              {words(st)}
            </option>
          ))}
        </select>
        <span className="self-center text-sm text-text-secondary">{rows.length} shown</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Basic</TableHead>
                <TableHead>Lumpsum</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6}>Loading…</TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-text-secondary">
                    No employees
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.employeeId}>
                    <TableCell>
                      <Link to={`/employees/${r.employeeId}`} className="font-medium text-primary hover:underline">
                        {r.fullName}
                      </Link>
                      <div className="text-xs text-text-secondary">
                        {r.employeeCode}
                        {r.designation ? ` · ${r.designation}` : ''} · {words(r.status)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{r.branch ?? '—'}</TableCell>
                    <TableCell>{pkr(r.basicStipend)}</TableCell>
                    <TableCell>{pkr(r.lumpsumTotal)}</TableCell>
                    <TableCell>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_STYLE[r.state]}`}>
                        {STATE_LABEL[r.state]}
                      </span>
                      {r.pendingApproval ? (
                        <div className="mt-1 text-xs text-purple-700">Change waiting for approval</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.lastChange ? (
                        <>
                          {r.lastChange.type}
                          <div className="text-xs text-text-secondary">
                            {format(new Date(r.lastChange.at), 'dd MMM yyyy, h:mm a')} · {r.lastChange.by}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
