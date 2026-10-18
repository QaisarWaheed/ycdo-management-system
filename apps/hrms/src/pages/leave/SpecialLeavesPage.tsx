import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  SPECIAL_LEAVE_STATUS_LABELS,
  specialLeaveApi,
  type SpecialLeave,
} from '@/api/endpoints/specialLeave'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}
const day = (d: string) => format(new Date(d), 'dd/MM/yyyy')
export const PAY_LABEL: Record<number, string> = { 100: 'Full pay', 50: '50% pay', 0: 'Without pay' }

/** Phase 2 Req 2: employee / HR apply → HR Operations → Chairman (final) → attendance + salary. */
export function SpecialLeavesPage() {
  const { hasRole } = useAuth()
  const canDecideAny = hasRole(['SUPER_ADMIN', 'HR_OPERATIONS_MANAGER', 'CHAIRMAN'])
  const canApply = hasRole(['SUPER_ADMIN', 'HR_MANAGER', 'HR_ADMIN_MANAGER', 'HR_OPERATIONS_MANAGER', 'HR_EXECUTIVE'])
  const canManageTypes = hasRole(['SUPER_ADMIN', 'HR_OPERATIONS_MANAGER'])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Special Leaves</h1>
        <p className="text-sm text-text-secondary">
          Maternity, accident, marriage and other special leaves. HR Operations approves first, then
          the Chairman gives the final approval. Pay follows the leave type (full / 50% / without
          pay) on working days; weekly offs stay paid. Not counted in the monthly leave quota.
        </p>
      </div>
      {canDecideAny && <PendingTable />}
      {canApply && <ApplyCard />}
      {canManageTypes && <TypesCard />}
    </div>
  )
}

function PendingTable() {
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<{ approve: boolean; item: SpecialLeave } | null>(null)
  const [note, setNote] = useState('')
  const { data = [], isLoading } = useQuery({
    queryKey: ['special-leave-pending'],
    queryFn: () => specialLeaveApi.pending(),
  })
  const canDecide = (item: SpecialLeave) =>
    hasRole(['SUPER_ADMIN']) ||
    hasRole([item.status === 'CHAIRMAN_PENDING' ? 'CHAIRMAN' : 'HR_OPERATIONS_MANAGER'])

  const mutation = useMutation({
    mutationFn: ({ approve, item }: { approve: boolean; item: SpecialLeave }) =>
      specialLeaveApi.decide(item.id, approve, note.trim() || undefined),
    onSuccess: (_r, { approve, item }) => {
      toast({
        title: !approve
          ? 'Rejected (final)'
          : item.status === 'CHAIRMAN_PENDING'
            ? 'Approved — attendance and salary updated'
            : 'Approved — sent to Chairman for final approval',
      })
      setAction(null)
      setNote('')
      queryClient.invalidateQueries({ queryKey: ['special-leave-pending'] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (err: ApiError) =>
      toast({ title: 'Failed', description: errText(err), variant: 'destructive' }),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Waiting for approval</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Leave</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Pay</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-text-secondary">Loading…</TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-text-secondary">Nothing waiting for approval</TableCell>
              </TableRow>
            ) : (
              data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium">{item.employee.fullName}</div>
                    <div className="text-xs text-text-secondary">
                      {item.employee.employeeCode} · {item.employee.currentBranch?.name ?? '—'}
                    </div>
                  </TableCell>
                  <TableCell>{item.specialLeaveType?.name ?? 'Special leave'}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {day(item.startDate)} – {day(item.endDate)}
                    <div className="text-xs text-text-secondary">{item.totalDays} day(s)</div>
                  </TableCell>
                  <TableCell>{PAY_LABEL[item.payPercent ?? 100]}</TableCell>
                  <TableCell className="max-w-[240px]">
                    <div className="truncate">{item.reason ?? '—'}</div>
                    {item.approvals.map((a, i) => (
                      <div key={i} className="truncate text-xs text-text-secondary">
                        {a.stage === 'CHAIRMAN' ? 'Chairman' : 'HR Ops'} {a.action.toLowerCase()}
                        {a.notes ? `: ${a.notes}` : ''}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{SPECIAL_LEAVE_STATUS_LABELS[item.status]}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {canDecide(item) ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="bg-primary hover:bg-primary-dark"
                          onClick={() => setAction({ approve: true, item })}
                        >
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setAction({ approve: false, item })}>
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-text-secondary">
                        {SPECIAL_LEAVE_STATUS_LABELS[item.status]}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open) {
            setAction(null)
            setNote('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {!action?.approve
                ? 'Reject (final)'
                : action.item.status === 'CHAIRMAN_PENDING'
                  ? 'Final approval'
                  : 'Approve and send to Chairman'}
            </DialogTitle>
          </DialogHeader>
          {action && (
            <div className="space-y-3">
              <p className="text-sm">
                {action.item.employee.fullName} · {action.item.specialLeaveType?.name} ·{' '}
                {day(action.item.startDate)} – {day(action.item.endDate)} ·{' '}
                {PAY_LABEL[action.item.payPercent ?? 100]}
              </p>
              <div className="space-y-1">
                <Label>Note (optional)</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>Cancel</Button>
            <Button
              disabled={mutation.isPending}
              className={action?.approve ? 'bg-primary hover:bg-primary-dark' : ''}
              variant={action?.approve ? 'default' : 'destructive'}
              onClick={() => action && mutation.mutate(action)}
            >
              {action?.approve ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function ApplyCard() {
  const queryClient = useQueryClient()
  const empty = { employeeId: '', specialLeaveTypeId: '', startDate: '', endDate: '', reason: '' }
  const [form, setForm] = useState(empty)
  const { data: types = [] } = useQuery({
    queryKey: ['special-leave-types'],
    queryFn: () => specialLeaveApi.types(),
  })
  const mutation = useMutation({
    mutationFn: () => specialLeaveApi.apply(form),
    onSuccess: () => {
      toast({ title: 'Special leave sent to HR Operations' })
      setForm(empty)
      queryClient.invalidateQueries({ queryKey: ['special-leave-pending'] })
    },
    onError: (err: ApiError) =>
      toast({ title: 'Failed', description: errText(err), variant: 'destructive' }),
  })
  const ready =
    form.employeeId && form.specialLeaveTypeId && form.startDate && form.endDate && form.reason.trim().length >= 3

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Enter special leave for an employee</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <EmployeeSearchSelect
          label="Employee"
          value={form.employeeId}
          onChange={(employeeId) => setForm((f) => ({ ...f, employeeId }))}
        />
        <div className="space-y-1">
          <Label>Leave type</Label>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.specialLeaveTypeId}
            onChange={(e) => setForm((f) => ({ ...f, specialLeaveTypeId: e.target.value }))}
          >
            <option value="">Select…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {PAY_LABEL[t.payPercent]}
                {t.maxDays ? ` (max ${t.maxDays} days)` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>From</Label>
          <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <Label>To</Label>
          <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Reason</Label>
          <Textarea value={form.reason} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
        </div>
        <div className="sm:col-span-2">
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={!ready || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Send to HR Operations
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function TypesCard() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState({ name: '', payPercent: 50, maxDays: '' })
  const { data: types = [] } = useQuery({
    queryKey: ['special-leave-types', 'all'],
    queryFn: () => specialLeaveApi.types(true),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['special-leave-types'] })
  const onError = (err: ApiError) =>
    toast({ title: 'Failed', description: errText(err), variant: 'destructive' })
  const create = useMutation({
    mutationFn: () =>
      specialLeaveApi.createType({
        name: draft.name,
        payPercent: draft.payPercent,
        maxDays: draft.maxDays ? Number(draft.maxDays) : null,
      }),
    onSuccess: () => {
      setDraft({ name: '', payPercent: 50, maxDays: '' })
      refresh()
    },
    onError,
  })
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof specialLeaveApi.updateType>[1] }) =>
      specialLeaveApi.updateType(id, data),
    onSuccess: refresh,
    onError,
  })
  const paySelect = (value: number, onChange: (v: 0 | 50 | 100) => void) => (
    <select
      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as 0 | 50 | 100)}
    >
      <option value={100}>Full pay (100%)</option>
      <option value={50}>50% pay / 50% deduction</option>
      <option value={0}>Without pay</option>
    </select>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Special leave types</CardTitle>
        <p className="text-xs text-text-secondary">
          A change applies to new requests only; leaves already entered keep their pay %.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Pay</TableHead>
              <TableHead>Max days</TableHead>
              <TableHead>Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>{paySelect(t.payPercent, (payPercent) => update.mutate({ id: t.id, data: { payPercent } }))}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    className="h-9 w-24"
                    defaultValue={t.maxDays ?? ''}
                    placeholder="No limit"
                    onBlur={(e) => {
                      const maxDays = e.target.value ? Number(e.target.value) : null
                      if (maxDays !== t.maxDays) update.mutate({ id: t.id, data: { maxDays } })
                    }}
                  />
                </TableCell>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={t.isActive}
                    onChange={(e) => update.mutate({ id: t.id, data: { isActive: e.target.checked } })}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>New type</Label>
            <Input placeholder="e.g. Maternity Leave" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </div>
          {paySelect(draft.payPercent, (payPercent) => setDraft((d) => ({ ...d, payPercent })))}
          <Input
            type="number"
            min={1}
            className="h-9 w-28"
            placeholder="Max days"
            value={draft.maxDays}
            onChange={(e) => setDraft((d) => ({ ...d, maxDays: e.target.value }))}
          />
          <Button disabled={!draft.name.trim() || create.isPending} onClick={() => create.mutate()}>
            Add type
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
