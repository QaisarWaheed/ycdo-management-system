import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { branchesApi } from '@/api/endpoints/branches'
import {
  doctorPerformanceApi,
  type DoctorPerformanceRow,
  type PerformanceFigures,
} from '@/api/endpoints/doctorPerformance'
import { incentivesApi } from '@/api/endpoints/incentives'
import { allowancesApi } from '@/api/endpoints/payApprovals'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

type FigureKey = Exclude<keyof PerformanceFigures, 'note'>
const FIELDS: Array<{ key: FigureKey; label: string; money?: boolean }> = [
  { key: 'opdPatients', label: 'OPD patients' },
  { key: 'indoorPatients', label: 'Indoor patients' },
  { key: 'surgeries', label: 'Surgeries' },
  { key: 'labTests', label: 'Lab tests' },
  { key: 'collection', label: 'Collection (PKR)', money: true },
]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const num = (n: number) => Math.round(n).toLocaleString('en-PK')
const ACTIVE = ['ACTIVE', 'APPOINTED']
const totalPatients = (f?: PerformanceFigures | null) =>
  f ? f.opdPatients + f.indoorPatients : null

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: unknown) => {
  const msg = (err as ApiError).response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

/** This month, last month and the change (green up / red down). */
function Trend({ prev, cur }: { prev: number | null; cur: number | null }) {
  if (cur == null && prev == null) return <span className="text-muted-foreground">—</span>
  const pct = prev && cur != null ? Math.round(((cur - prev) / prev) * 100) : null
  return (
    <div className="leading-tight">
      <div className="font-semibold tabular-nums">{cur == null ? '—' : num(cur)}</div>
      <div className="text-xs text-muted-foreground tabular-nums">
        last {prev == null ? '—' : num(prev)}
        {pct != null && pct !== 0 ? (
          <span className={cn('ml-1 font-medium', pct > 0 ? 'text-green-700' : 'text-red-600')}>
            {pct > 0 ? '▲' : '▼'}
            {Math.abs(pct)}%
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Doctors' monthly work. Finance enters patients, surgeries, lab tests and
 * collection; executives compare with last month and set incentives here
 * (an executive's incentive goes straight to payroll).
 */
export function DoctorPerformancePage() {
  const queryClient = useQueryClient()
  const { hasRole } = useAuth()
  const canEnter = hasRole(['PAYROLL_OFFICER', 'SUPER_ADMIN'])
  const canIncentive = hasRole(['PRESIDENT', 'FOUNDER', 'CHAIRMAN', 'SUPER_ADMIN'])
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [branchId, setBranchId] = useState('all')
  const [search, setSearch] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Partial<PerformanceFigures>>>({})
  const [rewards, setRewards] = useState<Record<string, { amount: number; typeId?: string }>>({})

  const params = { year, month, branchId: branchId === 'all' ? undefined : branchId }
  const { data, isLoading } = useQuery({
    queryKey: ['doctor-performance', params],
    queryFn: () => doctorPerformanceApi.list(params),
  })
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })
  const { data: types = [] } = useQuery({
    queryKey: ['incentive-types'],
    queryFn: allowancesApi.listIncentiveTypes,
    enabled: canIncentive,
  })
  const activeTypes = types.filter((t) => t.isActive)
  const defaultType = activeTypes[0]?.id

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.rows ?? []).filter(
      (r) =>
        !q ||
        r.employee.fullName.toLowerCase().includes(q) ||
        (r.employee.designation ?? '').toLowerCase().includes(q) ||
        (r.employee.branch ?? '').toLowerCase().includes(q),
    )
  }, [data, search])

  const value = (r: DoctorPerformanceRow, k: FigureKey) =>
    drafts[r.employee.id]?.[k] ?? r.current?.[k] ?? 0
  const setValue = (id: string, k: FigureKey, v: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [k]: Math.max(0, Number(v) || 0) } }))
  const changed = Object.keys(drafts)

  const save = useMutation({
    mutationFn: () =>
      doctorPerformanceApi.save({
        year,
        month,
        rows: (data?.rows ?? [])
          .filter((r) => drafts[r.employee.id])
          .map((r) => ({
            employeeId: r.employee.id,
            ...Object.fromEntries(FIELDS.map((f) => [f.key, value(r, f.key)])),
            note: drafts[r.employee.id]?.note ?? r.current?.note ?? undefined,
          })) as Array<PerformanceFigures & { employeeId: string }>,
      }),
    onSuccess: () => {
      toast({ title: `Saved figures for ${changed.length} doctor${changed.length > 1 ? 's' : ''}` })
      setDrafts({})
      queryClient.invalidateQueries({ queryKey: ['doctor-performance'] })
    },
    onError: (err) =>
      toast({ title: 'Could not save', description: errText(err), variant: 'destructive' }),
  })

  const rewardRows = Object.entries(rewards).filter(([, v]) => v.amount > 0)
  const giveIncentives = useMutation({
    mutationFn: async () => {
      const failed: string[] = []
      for (const [employeeId, v] of rewardRows) {
        try {
          await incentivesApi.create({
            employeeId,
            month,
            year,
            amount: v.amount,
            typeId: v.typeId ?? defaultType,
            reason: 'Monthly performance review',
          })
        } catch (err) {
          const name = data?.rows.find((r) => r.employee.id === employeeId)?.employee.fullName
          failed.push(`${name ?? employeeId}: ${errText(err)}`)
        }
      }
      return failed
    },
    onSuccess: (failed) => {
      const done = rewardRows.length - failed.length
      toast({
        title: `${done} incentive${done === 1 ? '' : 's'} added${failed.length ? `, ${failed.length} failed` : ''}`,
        description: failed.join('\n') || undefined,
        variant: failed.length ? 'destructive' : undefined,
      })
      setRewards({})
      queryClient.invalidateQueries({ queryKey: ['doctor-performance'] })
      queryClient.invalidateQueries({ queryKey: ['incentives'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
    },
  })

  const prevLabel = data ? `${MONTHS[data.previous.month - 1]} ${data.previous.year}` : ''

  const figureCell = (r: DoctorPerformanceRow, f: (typeof FIELDS)[number]) =>
    canEnter ? (
      <div className="space-y-0.5">
        <Input
          type="number"
          min={0}
          step={f.money ? '0.01' : '1'}
          inputMode="numeric"
          aria-label={`${f.label} for ${r.employee.fullName}`}
          className="h-8 w-28 tabular-nums"
          value={value(r, f.key)}
          onChange={(e) => setValue(r.employee.id, f.key, e.target.value)}
        />
        <div className="text-xs text-muted-foreground tabular-nums">
          last {r.previous ? num(r.previous[f.key]) : '—'}
        </div>
      </div>
    ) : (
      <Trend prev={r.previous?.[f.key] ?? null} cur={r.current?.[f.key] ?? null} />
    )

  const incentiveList = (r: DoctorPerformanceRow) =>
    r.incentives.length ? (
      <div className="space-y-0.5">
        {r.incentives.map((i, n) => (
          <div
            key={n}
            className={cn('text-xs', i.pending ? 'text-red-600' : 'text-green-700')}
            title={i.name}
          >
            <b className="tabular-nums">{num(i.amount)}</b> {i.pending ? 'pending approval' : i.name}
          </div>
        ))}
      </div>
    ) : (
      <span className="text-xs text-muted-foreground">None</span>
    )

  const rewardInput = (r: DoctorPerformanceRow) => {
    if (!ACTIVE.includes(r.employee.status))
      return (
        <span className="text-xs text-red-700">{r.employee.status.replace(/_/g, ' ')}: no incentive</span>
      )
    const v = rewards[r.employee.id] ?? { amount: 0 }
    return (
      <div className="flex flex-wrap items-center gap-1">
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          placeholder="Amount"
          aria-label={`Incentive for ${r.employee.fullName}`}
          className="h-8 w-24 tabular-nums"
          value={v.amount || ''}
          onChange={(e) =>
            setRewards((s) => ({
              ...s,
              [r.employee.id]: { ...v, amount: Math.max(0, Number(e.target.value) || 0) },
            }))
          }
        />
        {activeTypes.length > 1 ? (
          <Select
            value={v.typeId ?? defaultType}
            onValueChange={(typeId) => setRewards((s) => ({ ...s, [r.employee.id]: { ...v, typeId } }))}
          >
            <SelectTrigger className="h-8 w-32" aria-label="Incentive type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {activeTypes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    )
  }

  const years = [now.getFullYear(), now.getFullYear() - 1]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Doctor Performance</h1>
        <p className="text-sm text-muted-foreground">
          {canEnter
            ? 'Enter each doctor’s patients, surgeries, lab tests and collection for the month, then Save figures.'
            : 'This month against last month for every doctor. Enter an incentive where it is earned and save.'}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="w-28" aria-label="Month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={m} value={String(i + 1)}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-24" aria-label="Year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger className="w-56" aria-label="Branch">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All branches</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-56"
          placeholder="Search doctor, designation…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {prevLabel ? (
          <span className="text-xs text-muted-foreground">“last” = {prevLabel}</span>
        ) : null}
      </div>

      {canEnter || canIncentive ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-background/95 p-2 text-sm">
          {canEnter ? (
            <>
              <span className="text-muted-foreground">{changed.length} doctor(s) changed</span>
              <Button size="sm" disabled={!changed.length || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save figures'}
              </Button>
            </>
          ) : null}
          {canIncentive ? (
            <>
              <span className="text-muted-foreground">
                {rewardRows.length} incentive(s) · PKR {num(rewardRows.reduce((s, [, v]) => s + v.amount, 0))}
              </span>
              <Button
                size="sm"
                disabled={!rewardRows.length || giveIncentives.isPending}
                onClick={() => giveIncentives.mutate()}
              >
                {giveIncentives.isPending ? 'Saving…' : 'Save incentives'}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {/* Phones: one card per doctor. */}
      <div className="space-y-3 md:hidden">
        {isLoading ? (
          <p className="text-center text-sm">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">No doctors found</p>
        ) : (
          rows.map((r) => (
            <Card key={r.employee.id}>
              <CardContent className="space-y-3 p-3 text-sm">
                <div>
                  <div className="font-semibold">{r.employee.fullName}</div>
                  <div className="text-xs text-muted-foreground">
                    {[r.employee.employeeCode, r.employee.designation, r.employee.branch].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Total patients</div>
                    <Trend prev={totalPatients(r.previous)} cur={totalPatients(r.current)} />
                  </div>
                  {FIELDS.map((f) => (
                    <div key={f.key}>
                      <div className="text-xs text-muted-foreground">{f.label}</div>
                      {figureCell(r, f)}
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Incentives this month</div>
                  {incentiveList(r)}
                </div>
                {canIncentive ? rewardInput(r) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card className="hidden md:block">
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Doctor</TableHead>
                <TableHead>Total patients</TableHead>
                {FIELDS.map((f) => (
                  <TableHead key={f.key}>{f.label}</TableHead>
                ))}
                <TableHead>Incentives this month</TableHead>
                {canIncentive ? <TableHead>Give incentive</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center">Loading…</TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No doctors found
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.employee.id} className={drafts[r.employee.id] ? 'bg-amber-50/60' : undefined}>
                    <TableCell className="min-w-[180px]">
                      <div className="font-medium">{r.employee.fullName}</div>
                      <div className="text-xs text-muted-foreground">
                        {[r.employee.designation, r.employee.branch].filter(Boolean).join(' · ')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Trend
                        prev={totalPatients(r.previous)}
                        cur={
                          canEnter && drafts[r.employee.id]
                            ? value(r, 'opdPatients') + value(r, 'indoorPatients')
                            : totalPatients(r.current)
                        }
                      />
                    </TableCell>
                    {FIELDS.map((f) => (
                      <TableCell key={f.key}>{figureCell(r, f)}</TableCell>
                    ))}
                    <TableCell className="min-w-[140px]">{incentiveList(r)}</TableCell>
                    {canIncentive ? <TableCell>{rewardInput(r)}</TableCell> : null}
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
