import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { incentiveManagementApi, type BoardRow, type PayKind } from '@/api/endpoints/incentiveManagement'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { formatPKR } from '@/lib/stipendUtils'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const rowKey = (r: { employeeId: string; kind: PayKind; typeId: string }) => `${r.employeeId}|${r.kind}|${r.typeId}`
const SUGGEST_STATUS: Record<string, string> = {
  PENDING: 'Suggested',
  APPROVED: 'Approved',
  AMENDED: 'Approved (amended)',
  REJECTED: 'Rejected',
}

/**
 * Phase 2 Req 7 & 8: previous / suggested / current incentive and allowance per
 * employee and type. Department Heads and Accounts suggest; Chairman,
 * President and Founder approve (one by one or selected in bulk), amend,
 * reject or type the current amount. Typing an amount selects the row; the
 * approval dialog keeps the selection when closed.
 */
export function IncentiveManagementPage() {
  const { hasRole } = useAuth()
  const isExecutive = hasRole(['CHAIRMAN', 'PRESIDENT', 'FOUNDER', 'SUPER_ADMIN'])
  const canSuggest = hasRole(['DEPARTMENT_HEAD', 'PAYROLL_OFFICER', 'SUPER_ADMIN'])
  const queryClient = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [search, setSearch] = useState('')
  const [branch, setBranch] = useState('')
  const [department, setDepartment] = useState('')
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [extraRows, setExtraRows] = useState<BoardRow[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [adding, setAdding] = useState({ employeeId: '', type: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['incentive-management', month, year],
    queryFn: () => incentiveManagementApi.board(month, year),
  })
  const resetMonth = (m: number, y: number) => {
    setMonth(m)
    setYear(y)
    setAmounts({})
    setSelected(new Set())
    setExtraRows([])
  }

  const empById = useMemo(() => new Map((data?.employees ?? []).map((e) => [e.id, e])), [data])
  const allRows = useMemo(() => {
    const base = data?.rows ?? []
    const seen = new Set(base.map(rowKey))
    return [...base, ...extraRows.filter((r) => !seen.has(rowKey(r)))]
  }, [data, extraRows])
  const visible = allRows
    .filter((r) => {
      const e = empById.get(r.employeeId)
      if (!e) return false
      if (branch && e.branch !== branch) return false
      if (department && e.department !== department) return false
      const q = search.trim().toLowerCase()
      return !q || e.fullName.toLowerCase().includes(q) || (e.employeeCode ?? '').toLowerCase().includes(q)
    })
    .sort(
      (a, b) =>
        (empById.get(a.employeeId)?.fullName ?? '').localeCompare(empById.get(b.employeeId)?.fullName ?? '') ||
        a.typeName.localeCompare(b.typeName),
    )
  const branches = [...new Set((data?.employees ?? []).map((e) => e.branch).filter(Boolean))] as string[]
  const departments = [...new Set((data?.employees ?? []).map((e) => e.department).filter(Boolean))] as string[]

  const proposed = (r: BoardRow) => amounts[rowKey(r)] ?? r.suggestion?.amount ?? r.current
  const setAmount = (r: BoardRow, value: number) => {
    const k = rowKey(r)
    setAmounts((a) => ({ ...a, [k]: value }))
    setSelected((s) => new Set(s).add(k)) // Req 8: entering an amount selects the employee
  }
  const toggle = (k: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const selectedRows = allRows.filter((r) => selected.has(rowKey(r)))

  // Approval dialog numbers (per employee for increase / decrease / same).
  const perEmp = new Map<string, { prev: number; next: number }>()
  for (const r of selectedRows) {
    const p = perEmp.get(r.employeeId) ?? { prev: 0, next: 0 }
    p.prev += r.previous
    p.next += proposed(r)
    perEmp.set(r.employeeId, p)
  }
  const stats = { employees: perEmp.size, rows: selectedRows.length, prevTotal: 0, nextTotal: 0, up: 0, down: 0, same: 0, issues: 0 }
  for (const [id, p] of perEmp) {
    stats.prevTotal += p.prev
    stats.nextTotal += p.next
    if (p.next > p.prev) stats.up++
    else if (p.next < p.prev) stats.down++
    else stats.same++
    if ((empById.get(id)?.issues.length ?? 0) > 0 || p.next < p.prev) stats.issues++
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['incentive-management'] })
  const apply = useMutation({
    mutationFn: () =>
      incentiveManagementApi.apply({
        month,
        year,
        items: selectedRows.map((r) => ({ employeeId: r.employeeId, kind: r.kind, typeId: r.typeId, amount: proposed(r) })),
      }),
    onSuccess: (res) => {
      toast({
        title: `${res.applied} approved`,
        description: res.failed.length
          ? `${res.failed.length} could not be applied: ${res.failed.map((f) => f.reason).join('; ')}`
          : undefined,
        variant: res.failed.length ? 'destructive' : undefined,
      })
      const failedKeys = new Set(res.failed.map((f) => `${f.employeeId}|${f.typeId}`))
      setSelected(new Set(selectedRows.filter((r) => failedKeys.has(`${r.employeeId}|${r.typeId}`)).map(rowKey)))
      setAmounts({})
      setExtraRows([])
      setConfirmOpen(false)
      refresh()
      queryClient.invalidateQueries({ queryKey: ['incentives'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (err: ApiError) => toast({ title: 'Approval failed', description: errText(err), variant: 'destructive' }),
  })
  const pendingIds = selectedRows.filter((r) => r.suggestion?.status === 'PENDING').map((r) => r.suggestion!.id)
  const reject = useMutation({
    mutationFn: () => incentiveManagementApi.reject(pendingIds),
    onSuccess: (res) => {
      toast({ title: `${res.rejected} suggestion(s) rejected` })
      // Rejected rows are unselected so the amounts can be corrected.
      setSelected(new Set())
      refresh()
    },
    onError: (err: ApiError) => toast({ title: 'Reject failed', description: errText(err), variant: 'destructive' }),
  })
  const saveSuggestions = useMutation({
    mutationFn: async () => {
      const edited = allRows.filter((r) => amounts[rowKey(r)] !== undefined)
      for (const r of edited) {
        await incentiveManagementApi.suggest({
          employeeId: r.employeeId,
          kind: r.kind,
          typeId: r.typeId,
          month,
          year,
          amount: amounts[rowKey(r)],
        })
      }
      return edited.length
    },
    onSuccess: (n) => {
      toast({ title: `${n} suggestion(s) sent to executives` })
      setAmounts({})
      setSelected(new Set())
      setExtraRows([])
      refresh()
    },
    onError: (err: ApiError) => toast({ title: 'Could not save', description: errText(err), variant: 'destructive' }),
  })

  const actionBar = isExecutive ? (
    <div className="flex flex-wrap items-center gap-2">
      <Button className="bg-primary hover:bg-primary-dark" disabled={!selectedRows.length} onClick={() => setConfirmOpen(true)}>
        Approve selected ({stats.employees} employees)
      </Button>
      <Button variant="outline" disabled={!pendingIds.length || reject.isPending} onClick={() => reject.mutate()}>
        Reject selected suggestions ({pendingIds.length})
      </Button>
      {selectedRows.length ? (
        <Button variant="ghost" onClick={() => setSelected(new Set())}>
          Clear selection
        </Button>
      ) : null}
    </div>
  ) : canSuggest ? (
    <Button
      className="bg-primary hover:bg-primary-dark"
      disabled={!Object.keys(amounts).length || saveSuggestions.isPending}
      onClick={() => saveSuggestions.mutate()}
    >
      Send suggestions ({Object.keys(amounts).length})
    </Button>
  ) : null

  const addRow = () => {
    const [kind, typeId] = adding.type.split('|') as [PayKind, string]
    const t = [...(data?.incentiveTypes ?? []), ...(data?.allowanceTypes ?? [])].find((x) => x.id === typeId)
    if (!adding.employeeId || !t) return
    setExtraRows((rows) => [
      ...rows,
      { employeeId: adding.employeeId, kind, typeId, typeName: t.name, previous: 0, current: 0, suggestion: null },
    ])
    setAdding({ employeeId: '', type: '' })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Incentive &amp; Allowance Management</h1>
        <p className="text-sm text-text-secondary">
          Previous month, suggested and current amount per employee and type.{' '}
          {isExecutive
            ? 'Type an amount (the row is selected), then approve the selection.'
            : 'Type your suggested amounts and send them to the executives.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={month}
          onChange={(e) => resetMonth(Number(e.target.value), year)}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <Input type="number" className="h-9 w-24" value={year} onChange={(e) => resetMonth(month, Number(e.target.value))} />
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <Input className="h-9 w-56" placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {actionBar}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {isExecutive ? (
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={visible.length > 0 && visible.every((r) => selected.has(rowKey(r)))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(visible.map(rowKey)) : new Set())}
                    />
                  </TableHead>
                ) : null}
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Previous</TableHead>
                <TableHead className="text-right">Suggested</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">{isExecutive ? 'Approve amount' : 'Your suggestion'}</TableHead>
                {isExecutive ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-text-secondary">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-text-secondary">
                    Nothing for this month yet. Add a row below.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((r) => {
                  const k = rowKey(r)
                  const e = empById.get(r.employeeId)!
                  const value = proposed(r)
                  return (
                    <TableRow key={k} className={selected.has(k) ? 'bg-primary/5' : ''}>
                      {isExecutive ? (
                        <TableCell>
                          <input type="checkbox" aria-label={`Select ${e.fullName}`} checked={selected.has(k)} onChange={() => toggle(k)} />
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <div className="font-medium">{e.fullName}</div>
                        <div className="text-xs text-text-secondary">
                          {e.employeeCode} · {e.branch ?? '—'} · {e.department ?? '—'}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {e.issues.map((i) => (
                            <Badge key={i} variant="outline" className="border-amber-300 text-amber-800">
                              {i}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.typeName}
                        <div className="text-xs text-text-secondary">{r.kind === 'INCENTIVE' ? 'Incentive' : 'Allowance'}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.previous ? formatPKR(r.previous) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.suggestion ? (
                          <>
                            {formatPKR(r.suggestion.amount)}
                            <div className="text-xs text-text-secondary">{SUGGEST_STATUS[r.suggestion.status]}</div>
                          </>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.current ? formatPKR(r.current) : '—'}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          className={`ml-auto h-8 w-28 text-right ${value < r.previous ? 'border-amber-400' : ''}`}
                          value={amounts[k] ?? (isExecutive ? value : (r.suggestion?.amount ?? ''))}
                          onChange={(ev) => setAmount(r, Math.max(0, Number(ev.target.value) || 0))}
                        />
                      </TableCell>
                      {isExecutive ? (
                        <TableCell className="whitespace-nowrap">
                          {r.suggestion?.status === 'PENDING' ? (
                            <Button size="sm" variant="outline" onClick={() => setAmount(r, r.suggestion!.amount)}>
                              Use suggestion
                            </Button>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={adding.employeeId}
          onChange={(e) => setAdding((a) => ({ ...a, employeeId: e.target.value }))}
        >
          <option value="">Add row: employee…</option>
          {(data?.employees ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.fullName} ({e.employeeCode})
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={adding.type}
          onChange={(e) => setAdding((a) => ({ ...a, type: e.target.value }))}
        >
          <option value="">type…</option>
          <optgroup label="Incentives">
            {(data?.incentiveTypes ?? []).map((t) => (
              <option key={t.id} value={`INCENTIVE|${t.id}`}>
                {t.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Allowances">
            {(data?.allowanceTypes ?? []).map((t) => (
              <option key={t.id} value={`ALLOWANCE|${t.id}`}>
                {t.name}
              </option>
            ))}
          </optgroup>
        </select>
        <Button variant="outline" disabled={!adding.employeeId || !adding.type} onClick={addRow}>
          Add row
        </Button>
      </div>

      {actionBar}

      {/* Closing keeps the selection and amounts; Approve reopens with the same numbers. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve incentives / allowances</DialogTitle>
          </DialogHeader>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            <dt>Selected employees</dt>
            <dd className="text-right font-medium">
              {stats.employees} ({stats.rows} lines)
            </dd>
            <dt>Previous month total</dt>
            <dd className="text-right tabular-nums">{formatPKR(stats.prevTotal)}</dd>
            <dt>This month total (proposed)</dt>
            <dd className="text-right font-medium tabular-nums">{formatPKR(stats.nextTotal)}</dd>
            <dt>Difference</dt>
            <dd className={`text-right tabular-nums ${stats.nextTotal - stats.prevTotal < 0 ? 'text-red-600' : 'text-green-700'}`}>
              {stats.nextTotal - stats.prevTotal >= 0 ? '+' : ''}
              {formatPKR(stats.nextTotal - stats.prevTotal)}
            </dd>
            <dt>Increased</dt>
            <dd className="text-right">{stats.up}</dd>
            <dt>Decreased</dt>
            <dd className="text-right">{stats.down}</dd>
            <dt>Same</dt>
            <dd className="text-right">{stats.same}</dd>
            <dt>With performance issues or a decrease</dt>
            <dd className="text-right">{stats.issues}</dd>
          </dl>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={!pendingIds.length || reject.isPending}
              onClick={() => {
                setConfirmOpen(false)
                reject.mutate()
              }}
            >
              Reject
            </Button>
            <Button className="bg-primary hover:bg-primary-dark" disabled={apply.isPending} onClick={() => apply.mutate()}>
              Confirm approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
