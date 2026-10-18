import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  payrollMonthlyApi,
  useActivityWindow,
  windowText,
  type CorrectionLine,
  type PayrollActivity,
  type SalaryCorrection,
  type WorkflowEntry,
} from '@/api/endpoints/payrollMonthly'
import { userAccessApi } from '@/api/endpoints/userAccess'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { AppointmentLetterButton } from '@/components/letters/AppointmentLetterButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { formatRole } from '@/lib/roleLabels'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}
const onError = (err: ApiError) => toast({ title: 'Failed', description: errText(err), variant: 'destructive' })
const pkr = (n: number | string | null | undefined) => `PKR ${Math.round(Number(n ?? 0)).toLocaleString('en-PK')}`
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Last month = the salary month this month's workflow is about. */
function lastMonth() {
  const d = new Date()
  return d.getMonth() === 0 ? { month: 12, year: d.getFullYear() - 1 } : { month: d.getMonth(), year: d.getFullYear() }
}

function WindowBanner({ activity }: { activity: PayrollActivity }) {
  const w = useActivityWindow(activity)
  if (!w) return null
  return (
    <p
      className={`rounded-md border p-2 text-sm ${
        w.open ? 'border-green-300 bg-green-50 text-green-900' : 'border-amber-300 bg-amber-50 text-amber-900'
      }`}
    >
      <b>{w.label}:</b> {windowText(w)}
    </p>
  )
}

function MonthPicker({ value, onChange }: { value: { month: number; year: number }; onChange: (v: { month: number; year: number }) => void }) {
  const years = [value.year - 1, value.year, value.year + 1]
  return (
    <div className="flex gap-2">
      <Select value={String(value.month)} onValueChange={(m) => onChange({ ...value, month: Number(m) })}>
        <SelectTrigger className="w-[140px]">
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
      <Select value={String(value.year)} onValueChange={(y) => onChange({ ...value, year: Number(y) })}>
        <SelectTrigger className="w-[100px]">
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
    </div>
  )
}

/** Checkbox selection over a list of ids. */
function useSelection(ids: string[]) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const live = ids.filter((id) => picked.has(id))
  return {
    selected: live,
    has: (id: string) => picked.has(id),
    toggle: (id: string) =>
      setPicked((s) => {
        const n = new Set(s)
        if (n.has(id)) n.delete(id)
        else n.add(id)
        return n
      }),
    all: live.length === ids.length && ids.length > 0,
    toggleAll: () => setPicked(live.length === ids.length ? new Set() : new Set(ids)),
    clear: () => setPicked(new Set()),
  }
}

// ─── HR Operations: price and forward employees' correction requests ───

function claimText(c: SalaryCorrection) {
  return (c.claimItems ?? []).map((i) => `${i.date}${i.hours ? ` · ${i.hours}h` : ''}${i.note ? ` · ${i.note}` : ''}`)
}

function HrPriceDialog({ correction, onClose }: { correction: SalaryCorrection; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: rate } = useQuery({
    queryKey: ['salary-corrections', 'rate', correction.id],
    queryFn: () => payrollMonthlyApi.correctionRate(correction.id),
  })
  const initial: CorrectionLine[] =
    correction.category === 'OVERTIME'
      ? (correction.claimItems ?? []).map((i) => ({ kind: 'OVERTIME', hours: i.hours ?? 0, note: i.date }))
      : correction.category === 'EXTRA_DUTY'
        ? (correction.claimItems ?? []).map((i) => ({ kind: 'EXTRA_DUTY', days: 1, note: i.date }))
        : [{ kind: correction.category === 'DEDUCTION' ? 'DEDUCT' : 'ADD', amount: 0 }]
  const [lines, setLines] = useState<CorrectionLine[]>(initial)
  const [note, setNote] = useState('')

  const daily = rate ? rate.basic / rate.daysInMonth : 0
  const hourly = rate && rate.dailyHours ? daily / rate.dailyHours : 0
  const amountOf = (l: CorrectionLine) =>
    l.kind === 'OVERTIME' ? (l.hours ?? 0) * hourly : l.kind === 'EXTRA_DUTY' ? (l.days ?? 0) * daily : l.amount ?? 0
  const impact = lines.reduce((t, l) => t + (l.kind === 'DEDUCT' ? -1 : 1) * amountOf(l), 0)

  const decide = useMutation({
    mutationFn: (accept: boolean) => payrollMonthlyApi.hrDecide(correction.id, { accept, lines: accept ? lines : undefined, note }),
    onSuccess: (_r, accept) => {
      toast({ title: accept ? 'Forwarded to the Chairman' : 'Rejected; the employee is notified' })
      qc.invalidateQueries({ queryKey: ['salary-corrections'] })
      onClose()
    },
    onError,
  })
  const set = (i: number, patch: Partial<CorrectionLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {correction.employee.fullName} — {MONTHS[correction.month - 1]} {correction.year}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="whitespace-pre-wrap rounded-md border p-2">{correction.details}</p>
          {claimText(correction).length ? <p className="text-muted-foreground">Claimed: {claimText(correction).join(' | ')}</p> : null}
          {rate ? (
            <p className="text-muted-foreground">
              Basic {pkr(rate.basic)} · daily {pkr(daily)} · hourly {pkr(hourly)} ({rate.dailyHours} h/day, {rate.daysInMonth} days)
            </p>
          ) : null}
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select value={l.kind} onValueChange={(k) => set(i, { kind: k as CorrectionLine['kind'] })}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OVERTIME">Overtime (hours)</SelectItem>
                    <SelectItem value="EXTRA_DUTY">Extra duty (days)</SelectItem>
                    <SelectItem value="ADD">Add amount</SelectItem>
                    <SelectItem value="DEDUCT">Deduct amount</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  className="w-[110px]"
                  value={(l.kind === 'OVERTIME' ? l.hours : l.kind === 'EXTRA_DUTY' ? l.days : l.amount) ?? 0}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    set(i, l.kind === 'OVERTIME' ? { hours: v } : l.kind === 'EXTRA_DUTY' ? { days: v } : { amount: v })
                  }}
                />
                <Input className="flex-1" placeholder="Note / date" value={l.note ?? ''} onChange={(e) => set(i, { note: e.target.value })} />
                <span className="w-[110px] text-right">{pkr(amountOf(l))}</span>
                <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_x, j) => j !== i))}>
                  ✕
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { kind: 'OVERTIME', hours: 0 }])}>
              Add line
            </Button>
          </div>
          <p className="font-medium">Financial impact: {pkr(impact)}</p>
          <div className="space-y-1">
            <Label>Note (required to reject)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button variant="destructive" disabled={decide.isPending || note.trim().length < 2} onClick={() => decide.mutate(false)}>
            Reject
          </Button>
          <Button disabled={decide.isPending || !lines.length} onClick={() => decide.mutate(true)}>
            Verify & forward to Chairman
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CorrectionsTable({
  rows,
  action,
  selection,
}: {
  rows: SalaryCorrection[]
  action?: (c: SalaryCorrection) => React.ReactNode
  selection?: ReturnType<typeof useSelection>
}) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing waiting.</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selection ? (
            <TableHead className="w-8">
              <input type="checkbox" checked={selection.all} onChange={selection.toggleAll} />
            </TableHead>
          ) : null}
          <TableHead>Employee</TableHead>
          <TableHead>Month</TableHead>
          <TableHead>Request</TableHead>
          <TableHead>HR Operations</TableHead>
          <TableHead className="text-right">Impact</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.id}>
            {selection ? (
              <TableCell>
                <input type="checkbox" checked={selection.has(c.id)} onChange={() => selection.toggle(c.id)} />
              </TableCell>
            ) : null}
            <TableCell>
              <EmployeeNameLink employee={c.employee} />
              <p className="text-xs text-muted-foreground">
                {c.employee.employeeCode} · {c.employee.currentBranch?.name ?? '—'} · {c.employee.currentDepartment?.name ?? '—'}
              </p>
            </TableCell>
            <TableCell>
              {MONTHS[c.month - 1].slice(0, 3)} {c.year}
            </TableCell>
            <TableCell className="max-w-xs text-sm">
              <Badge variant="outline">{c.category}</Badge> <span className="whitespace-pre-wrap">{c.details}</span>
              {claimText(c).length ? <p className="text-xs text-muted-foreground">{claimText(c).join(' | ')}</p> : null}
            </TableCell>
            <TableCell className="max-w-xs text-xs">
              {(c.hrLines ?? []).map((l, i) => (
                <p key={i}>
                  {l.kind}
                  {l.hours ? ` ${l.hours}h` : ''}
                  {l.days ? ` ${l.days}d` : ''} = {pkr(l.signed)}
                  {l.note ? ` (${l.note})` : ''}
                </p>
              ))}
              {c.hrNote ? <p className="text-muted-foreground">{c.hrNote}</p> : null}
            </TableCell>
            <TableCell className="text-right">{c.impactAmount != null ? pkr(c.impactAmount) : '—'}</TableCell>
            <TableCell>{action?.(c)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function HrSuggestionsTab() {
  const { data = [] } = useQuery({
    queryKey: ['salary-corrections', 'SUBMITTED'],
    queryFn: () => payrollMonthlyApi.corrections({ status: 'SUBMITTED' }),
  })
  const [open, setOpen] = useState<SalaryCorrection | null>(null)
  return (
    <div className="space-y-3">
      <WindowBanner activity="HR_SALARY_CORRECTIONS" />
      <CorrectionsTable
        rows={data}
        action={(c) => (
          <Button size="sm" onClick={() => setOpen(c)}>
            Review
          </Button>
        )}
      />
      {open ? <HrPriceDialog correction={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

// ─── Chairman: individual, bulk or selective approval ───

function ChairmanTab() {
  const qc = useQueryClient()
  const { data = [] } = useQuery({
    queryKey: ['salary-corrections', 'FORWARDED'],
    queryFn: () => payrollMonthlyApi.corrections({ status: 'FORWARDED' }),
  })
  const sel = useSelection(data.map((c) => c.id))
  const [note, setNote] = useState('')
  const decide = useMutation({
    mutationFn: (v: { ids: string[]; approve: boolean }) => payrollMonthlyApi.chairmanDecide(v.ids, v.approve, note || undefined),
    onSuccess: (r) => {
      toast({ title: `${r.done} done`, description: r.failed.map((f) => f.error).join('; ') || undefined })
      sel.clear()
      qc.invalidateQueries({ queryKey: ['salary-corrections'] })
    },
    onError,
  })
  const impact = data.filter((c) => sel.has(c.id)).reduce((t, c) => t + Number(c.impactAmount ?? 0), 0)
  const bar = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm">
        {sel.selected.length} selected · impact {pkr(impact)}
      </span>
      <Button size="sm" disabled={!sel.selected.length || decide.isPending} onClick={() => decide.mutate({ ids: sel.selected, approve: true })}>
        Approve selected
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={!sel.selected.length || decide.isPending}
        onClick={() => decide.mutate({ ids: sel.selected, approve: false })}
      >
        Reject selected
      </Button>
    </div>
  )
  return (
    <div className="space-y-3">
      <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {data.length ? bar : null}
      <CorrectionsTable
        rows={data}
        selection={sel}
        action={(c) => (
          <div className="flex gap-1">
            <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ ids: [c.id], approve: true })}>
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ ids: [c.id], approve: false })}>
              Reject
            </Button>
          </div>
        )}
      />
      {data.length > 10 ? bar : null}
    </div>
  )
}

// ─── Founder approval and Project Coordinator proof-reading ───

function EntriesTable({
  rows,
  selection,
  action,
}: {
  rows: WorkflowEntry[]
  selection: ReturnType<typeof useSelection>
  action?: (e: WorkflowEntry) => React.ReactNode
}) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing waiting.</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">
            <input type="checkbox" checked={selection.all} onChange={selection.toggleAll} />
          </TableHead>
          <TableHead>Employee</TableHead>
          <TableHead className="text-right">Basic</TableHead>
          <TableHead className="text-right">Allowances</TableHead>
          <TableHead className="text-right">Deductions</TableHead>
          <TableHead className="text-right">Net</TableHead>
          <TableHead>Issues</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((e) => {
          const emp = e.stipendRecord.employee
          return (
            <TableRow key={e.id}>
              <TableCell>
                <input type="checkbox" checked={selection.has(e.id)} onChange={() => selection.toggle(e.id)} />
              </TableCell>
              <TableCell>
                <EmployeeNameLink employee={emp} />
                <p className="text-xs text-muted-foreground">
                  {emp.employeeCode} · {emp.currentDesignation ?? '—'} · {emp.currentBranch?.name ?? '—'}
                </p>
              </TableCell>
              <TableCell className="text-right">{pkr(e.basicStipend)}</TableCell>
              <TableCell className="text-right">{pkr(e.totalAllowances)}</TableCell>
              <TableCell className="text-right text-red-600">{pkr(e.totalDeductions)}</TableCell>
              <TableCell className="text-right font-semibold">{pkr(e.netStipend)}</TableCell>
              <TableCell className="max-w-xs text-xs">
                {e.reviewIssues.map((i) => (
                  <p key={i.id}>
                    <Badge variant="outline">{i.status}</Badge> {i.note}
                    {i.response ? ` → ${i.response}` : ''}
                  </p>
                ))}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <AppointmentLetterButton employeeId={emp.id} />
                  {action?.(e)}
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function useEntries(status: string) {
  const [period, setPeriod] = useState(lastMonth)
  const query = useQuery({
    queryKey: ['payroll-workflow', 'entries', status, period],
    queryFn: () => payrollMonthlyApi.entries({ ...period, status }),
  })
  const rows = query.data ?? []
  const sel = useSelection(rows.map((r) => r.id))
  return { period, setPeriod, rows, sel }
}

/** Proof-reading issues the Project Coordinator raised: resolve, or reopen for Finance. */
function PcIssuesForFounder() {
  const qc = useQueryClient()
  const { data = [] } = useQuery({
    queryKey: ['payroll-workflow', 'issues', 'PC_PROOF_READING'],
    queryFn: () => payrollMonthlyApi.issues({ kind: 'PC_PROOF_READING' }),
  })
  const [answer, setAnswer] = useState<Record<string, string>>({})
  const respond = useMutation({
    mutationFn: (v: { id: string; reopen: boolean }) => payrollMonthlyApi.respondIssue(v.id, { response: answer[v.id] ?? '', reopen: v.reopen }),
    onSuccess: (_r, v) => {
      toast({ title: v.reopen ? 'Slip reopened for Finance' : 'Resolved; the Project Coordinator can verify again' })
      qc.invalidateQueries({ queryKey: ['payroll-workflow'] })
    },
    onError,
  })
  const open = data.filter((i) => i.status === 'OPEN')
  if (!open.length) return null
  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <p className="font-medium">Proof-reading issues ({open.length})</p>
        {open.map((i) => {
          const ready = (answer[i.id] ?? '').trim().length >= 2
          return (
            <div key={i.id} className="space-y-2 rounded-md border p-2 text-sm">
              <p>
                <EmployeeNameLink employee={i.payrollEntry.stipendRecord.employee} /> — {MONTHS[i.payrollEntry.month - 1]} {i.payrollEntry.year} · net{' '}
                {pkr(i.payrollEntry.netStipend)}
              </p>
              <p className="whitespace-pre-wrap">{i.note}</p>
              <Textarea placeholder="Your answer" value={answer[i.id] ?? ''} onChange={(e) => setAnswer((a) => ({ ...a, [i.id]: e.target.value }))} />
              <div className="flex gap-2">
                <Button size="sm" disabled={respond.isPending || !ready} onClick={() => respond.mutate({ id: i.id, reopen: false })}>
                  Resolve (no change)
                </Button>
                <Button size="sm" variant="outline" disabled={respond.isPending || !ready} onClick={() => respond.mutate({ id: i.id, reopen: true })}>
                  Reopen for Finance
                </Button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function FounderTab() {
  const qc = useQueryClient()
  const { period, setPeriod, rows, sel } = useEntries('VERIFIED')
  const approve = useMutation({
    mutationFn: (ids: string[]) => payrollMonthlyApi.founderApprove(ids),
    onSuccess: (r) => {
      toast({ title: `${r.done} approved`, description: r.failed.map((f) => f.error).join('; ') || undefined })
      sel.clear()
      qc.invalidateQueries({ queryKey: ['payroll-workflow'] })
      qc.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError,
  })
  const total = rows.filter((r) => sel.has(r.id)).reduce((t, r) => t + Number(r.netStipend), 0)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker value={period} onChange={setPeriod} />
        <span className="text-sm">
          {sel.selected.length} selected · net {pkr(total)}
        </span>
        <Button disabled={!sel.selected.length || approve.isPending} onClick={() => approve.mutate(sel.selected)}>
          Approve selected
        </Button>
      </div>
      <EntriesTable rows={rows} selection={sel} />
      <PcIssuesForFounder />
    </div>
  )
}

function PcTab() {
  const qc = useQueryClient()
  const { period, setPeriod, rows, sel } = useEntries('FOUNDER_APPROVED')
  const [issueFor, setIssueFor] = useState<WorkflowEntry | null>(null)
  const [note, setNote] = useState('')
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['payroll-workflow'] })
    qc.invalidateQueries({ queryKey: ['payroll'] })
  }
  const verify = useMutation({
    mutationFn: (ids: string[]) => payrollMonthlyApi.pcVerify(ids),
    onSuccess: (r) => {
      toast({ title: `${r.done} verified`, description: r.failed.map((f) => f.error).join('; ') || undefined })
      sel.clear()
      refresh()
    },
    onError,
  })
  const raise = useMutation({
    mutationFn: (entryId: string) => payrollMonthlyApi.raiseIssue({ entryId, kind: 'PC_PROOF_READING', note }),
    onSuccess: () => {
      toast({ title: 'Sent to the Founder for review' })
      setIssueFor(null)
      setNote('')
      refresh()
    },
    onError,
  })
  return (
    <div className="space-y-4">
      <WindowBanner activity="PC_PROOF_READING" />
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker value={period} onChange={setPeriod} />
        <span className="text-sm">{sel.selected.length} selected</span>
        <Button disabled={!sel.selected.length || verify.isPending} onClick={() => verify.mutate(sel.selected)}>
          Verify selected
        </Button>
      </div>
      <EntriesTable
        rows={rows}
        selection={sel}
        action={(e) => (
          <Button size="sm" variant="outline" onClick={() => setIssueFor(e)}>
            Issue
          </Button>
        )}
      />
      {issueFor ? (
        <Dialog open onOpenChange={(o) => !o && setIssueFor(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Issue — {issueFor.stipendRecord.employee.fullName}</DialogTitle>
            </DialogHeader>
            <Textarea placeholder="What is wrong in this salary?" value={note} onChange={(e) => setNote(e.target.value)} />
            <DialogFooter>
              <Button disabled={raise.isPending || note.trim().length < 3} onClick={() => raise.mutate(issueFor.id)}>
                Send to Founder
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}

// ─── Corrections Finance sent to me (the person who made the entry) ───

function MyCorrectionsTab() {
  const qc = useQueryClient()
  const { data = [] } = useQuery({
    queryKey: ['payroll-workflow', 'issues', 'mine'],
    queryFn: () => payrollMonthlyApi.issues({ kind: 'FINANCE_CORRECTION', mine: '1' }),
  })
  const [answer, setAnswer] = useState<Record<string, string>>({})
  const respond = useMutation({
    mutationFn: (id: string) => payrollMonthlyApi.respondIssue(id, { response: answer[id] ?? '' }),
    onSuccess: () => {
      toast({ title: 'Sent back to Finance' })
      qc.invalidateQueries({ queryKey: ['payroll-workflow'] })
    },
    onError,
  })
  const open = data.filter((i) => i.status === 'OPEN')
  if (!open.length) return <p className="text-sm text-muted-foreground">No corrections assigned to you.</p>
  return (
    <div className="space-y-3">
      {open.map((i) => (
        <Card key={i.id}>
          <CardContent className="space-y-2 pt-4 text-sm">
            <p>
              <EmployeeNameLink employee={i.payrollEntry.stipendRecord.employee} /> — {MONTHS[i.payrollEntry.month - 1]} {i.payrollEntry.year}
              {i.lineKind ? (
                <Badge variant="outline" className="ml-2">
                  {i.lineKind}
                </Badge>
              ) : null}
            </p>
            <p className="whitespace-pre-wrap">Finance: {i.note}</p>
            <p className="text-xs text-muted-foreground">Correct your entry (incentive / allowance / deduction), then answer here.</p>
            <Textarea placeholder="What did you correct?" value={answer[i.id] ?? ''} onChange={(e) => setAnswer((a) => ({ ...a, [i.id]: e.target.value }))} />
            <Button size="sm" disabled={respond.isPending || (answer[i.id] ?? '').trim().length < 2} onClick={() => respond.mutate(i.id)}>
              Send back to Finance
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** Finance (in its window) sends a correction to whoever made an entry on a Pending slip. */
export function FinanceCorrectionDialog({ entryId, name, onClose }: { entryId: string; name: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: people = [] } = useQuery({ queryKey: ['payroll-workflow', 'assignees'], queryFn: payrollMonthlyApi.assignees })
  const [assignedToId, setAssignedToId] = useState('')
  const [note, setNote] = useState('')
  const raise = useMutation({
    mutationFn: () => payrollMonthlyApi.raiseIssue({ entryId, kind: 'FINANCE_CORRECTION', note, assignedToId }),
    onSuccess: () => {
      toast({ title: 'Correction sent' })
      qc.invalidateQueries({ queryKey: ['payroll-workflow'] })
      onClose()
    },
    onError,
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send correction — {name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <WindowBanner activity="FINANCE_VERIFICATION" />
          <div className="space-y-1">
            <Label>Who made the entry</Label>
            <Select value={assignedToId} onValueChange={setAssignedToId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a person" />
              </SelectTrigger>
              <SelectContent>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.employee?.fullName ?? p.email} · {formatRole(p.role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea placeholder="What should be corrected?" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button disabled={!assignedToId || note.trim().length < 3 || raise.isPending} onClick={() => raise.mutate()}>
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── IT: activity time extensions ───

const ACTIVITY_OPTIONS: Array<{ value: PayrollActivity; label: string }> = [
  { value: 'EMPLOYEE_SALARY_REVIEW', label: 'Employee salary review' },
  { value: 'HR_SALARY_CORRECTIONS', label: 'HR Operations salary suggestions' },
  { value: 'DEPT_INCHARGE_SUGGESTIONS', label: 'In-Charge incentives / allowances' },
  { value: 'FINANCE_VERIFICATION', label: 'Finance verification' },
  { value: 'PC_PROOF_READING', label: 'Project Coordinator proof-reading' },
]

function ExtensionsTab() {
  const qc = useQueryClient()
  const { data = [] } = useQuery({ queryKey: ['activity-windows', 'extensions'], queryFn: payrollMonthlyApi.extensions })
  const [search, setSearch] = useState('')
  const { data: users = [] } = useQuery({
    queryKey: ['user-access', 'search', search],
    queryFn: () => userAccessApi.getAll({ search, activeOnly: true }),
    enabled: search.trim().length >= 2,
  })
  const now = useMemo(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"), [])
  const [form, setForm] = useState({ userId: '', activity: 'FINANCE_VERIFICATION' as PayrollActivity, startsAt: now, endsAt: '', reason: '' })
  const grant = useMutation({
    mutationFn: () =>
      payrollMonthlyApi.grantExtension({
        ...form,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      }),
    onSuccess: () => {
      toast({ title: 'Extension granted' })
      setForm((f) => ({ ...f, userId: '', endsAt: '', reason: '' }))
      qc.invalidateQueries({ queryKey: ['activity-windows'] })
    },
    onError,
  })
  const revoke = useMutation({
    mutationFn: payrollMonthlyApi.revokeExtension,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity-windows'] }),
    onError,
  })
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 pt-4 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <Label>User (search email / name)</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type 2+ letters" />
            <Select value={form.userId} onValueChange={(userId) => setForm((f) => ({ ...f, userId }))}>
              <SelectTrigger>
                <SelectValue placeholder="Choose user" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.email} · {formatRole(u.role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Activity</Label>
            <Select value={form.activity} onValueChange={(a) => setForm((f) => ({ ...f, activity: a as PayrollActivity }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>From</Label>
            <Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Until</Label>
            <Input type="datetime-local" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Reason</Label>
            <Textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </div>
          <div>
            <Button disabled={!form.userId || !form.endsAt || form.reason.trim().length < 3 || grant.isPending} onClick={() => grant.mutate()}>
              Grant extension
            </Button>
          </div>
        </CardContent>
      </Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Activity</TableHead>
            <TableHead>From</TableHead>
            <TableHead>Until</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((x) => (
            <TableRow key={x.id}>
              <TableCell>
                {x.user.employee?.fullName ?? x.user.email}
                <p className="text-xs text-muted-foreground">{formatRole(x.user.role)}</p>
              </TableCell>
              <TableCell>{ACTIVITY_OPTIONS.find((o) => o.value === x.activity)?.label ?? x.activity}</TableCell>
              <TableCell>{format(new Date(x.startsAt), 'd MMM yyyy, h:mm a')}</TableCell>
              <TableCell>{format(new Date(x.endsAt), 'd MMM yyyy, h:mm a')}</TableCell>
              <TableCell className="max-w-xs text-sm">{x.reason}</TableCell>
              <TableCell>
                {x.revokedAt ? (
                  <Badge variant="outline">Revoked</Badge>
                ) : new Date(x.endsAt) < new Date() ? (
                  <Badge variant="outline">Ended</Badge>
                ) : (
                  <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(x.id)}>
                    Revoke
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Req 20: the monthly salary workflow screens, one tab per role. */
export function PayrollWorkflowPage() {
  const { hasRole } = useAuth()
  const tabs = [
    { key: 'hr', label: 'Salary suggestions', show: hasRole(['HR_OPERATIONS_MANAGER', 'SUPER_ADMIN']), el: <HrSuggestionsTab /> },
    { key: 'chairman', label: 'Chairman approval', show: hasRole(['CHAIRMAN', 'SUPER_ADMIN']), el: <ChairmanTab /> },
    { key: 'founder', label: 'Founder approval', show: hasRole(['FOUNDER', 'SUPER_ADMIN']), el: <FounderTab /> },
    { key: 'pc', label: 'Proof-reading', show: hasRole(['PROJECT_COORDINATOR', 'SUPER_ADMIN']), el: <PcTab /> },
    { key: 'mine', label: 'My corrections', show: true, el: <MyCorrectionsTab /> },
    { key: 'it', label: 'Time extensions', show: hasRole(['IT_ADMIN', 'SUPER_ADMIN']), el: <ExtensionsTab /> },
  ].filter((t) => t.show)
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Salary Workflow</h1>
        <p className="text-sm text-muted-foreground">
          1st–3rd: employees review · 3rd–5th: HR Operations → Chairman · 5th–7th: Finance verifies → Founder approves · 7th–10th: Project
          Coordinator proof-reads → Processed → Paid
        </p>
      </div>
      <Tabs defaultValue={tabs[0]?.key}>
        <TabsList className="h-auto flex-wrap">
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t.key} value={t.key}>
            {t.el}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
