import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import type { EmployeeApproverTarget } from '@/api/endpoints/employeeOnboarding'
import {
  allowancesApi,
  isPendingApproval,
  payApprovalsApi,
  type EmployeeAllowance,
} from '@/api/endpoints/payApprovals'
import { PKRInput } from '@/components/common/PKRInput'
import { ApproverSelect, useNeedsPayApproval } from '@/components/payroll/ApproverSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { formatPKR } from '@/lib/stipendUtils'

/** First month the allowance table pays (API PACKAGE_ALLOWANCES_FROM). */
export const ALLOWANCES_FROM_MONTH = '2026-11'

const MANAGE_ROLES = ['PAYROLL_OFFICER', 'PRESIDENT', 'FOUNDER', 'CHAIRMAN', 'SUPER_ADMIN']

const APPROVER_NAMES: Record<string, string> = {
  PRESIDENT: 'President',
  FOUNDER: 'Founder',
  CHAIRMAN_ADMIN: 'Chairman Admin',
}

const monthValue = (iso: string) => iso.slice(0, 7)
const monthText = (iso: string) => format(new Date(`${monthValue(iso)}-15`), 'MMM yyyy')
const thisMonth = () => {
  const d = new Date()
  const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  return v < ALLOWANCES_FROM_MONTH ? ALLOWANCES_FROM_MONTH : v
}

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

export function EmployeeAllowancesPanel({ employeeId }: { employeeId: string }) {
  const { hasRole } = useAuth()
  const canManage = hasRole(MANAGE_ROLES)
  const [editing, setEditing] = useState<EmployeeAllowance | 'new' | null>(null)
  const [ending, setEnding] = useState<EmployeeAllowance | null>(null)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['employee-allowances', employeeId],
    queryFn: () => allowancesApi.listForEmployee(employeeId),
  })
  const { data: pending = [] } = useQuery({
    queryKey: ['pay-approvals', 'employee', employeeId],
    queryFn: () => payApprovalsApi.list({ employeeId, status: 'PENDING' }),
  })

  const now = thisMonth()
  const status = (r: EmployeeAllowance) =>
    r.endMonth && monthValue(r.endMonth) < now
      ? 'Ended'
      : monthValue(r.startMonth) > now
        ? 'Upcoming'
        : 'Current'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Allowances</h3>
          <p className="text-xs text-muted-foreground">
            Paid from {monthText(`${ALLOWANCES_FROM_MONTH}-01`)} payroll. Earlier months use the
            old package fields.
          </p>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setEditing('new')}>
            Add / change allowance
          </Button>
        ) : null}
      </div>

      {pending.length > 0 ? (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Waiting for approval</p>
          {pending.map((p) => (
            <p key={p.id}>
              {p.summary}{' '}
              <span className="text-muted-foreground">
                — with {APPROVER_NAMES[p.approverTarget] ?? p.approverTarget}
              </span>
            </p>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Allowance</TableHead>
              <TableHead className="text-right">Monthly amount</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Paid as</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">Loading…</TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No allowances
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className={status(r) === 'Ended' ? 'opacity-60' : ''}>
                  <TableCell>
                    <div className="font-medium">{r.type.name}</div>
                    {r.note ? <div className="text-xs text-muted-foreground">{r.note}</div> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPKR(Number(r.amount))}
                  </TableCell>
                  <TableCell>{monthText(r.startMonth)}</TableCell>
                  <TableCell>{r.endMonth ? monthText(r.endMonth) : 'Ongoing'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {r.type.proration === 'ATTENDANCE' ? 'By attendance' : 'Full month'}
                    </Badge>{' '}
                    {status(r) !== 'Current' ? <Badge variant="secondary">{status(r)}</Badge> : null}
                  </TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap text-right">
                    {canManage && status(r) !== 'Ended' ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                          Change
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEnding(r)}>
                          End
                        </Button>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {editing ? (
        <AssignAllowanceDialog
          employeeId={employeeId}
          current={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {ending ? <EndAllowanceDialog row={ending} onClose={() => setEnding(null)} /> : null}
    </div>
  )
}

function AssignAllowanceDialog({
  employeeId,
  current,
  onClose,
}: {
  employeeId: string
  current: EmployeeAllowance | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const needsApproval = useNeedsPayApproval()
  const { data: types = [] } = useQuery({
    queryKey: ['allowance-types'],
    queryFn: allowancesApi.listTypes,
  })
  const [typeId, setTypeId] = useState(current?.typeId ?? '')
  const [amount, setAmount] = useState(current ? Number(current.amount) : 0)
  const [startMonth, setStartMonth] = useState(thisMonth())
  const [endMonth, setEndMonth] = useState('')
  const [note, setNote] = useState('')
  const [approver, setApprover] = useState<EmployeeApproverTarget>()

  const mutation = useMutation({
    mutationFn: () =>
      allowancesApi.assign({
        employeeId,
        typeId,
        amount,
        startMonth,
        endMonth: endMonth || undefined,
        note: note.trim(),
        approverTarget: approver,
      }),
    onSuccess: (res) => {
      toast({
        title: isPendingApproval(res)
          ? `Sent to ${res.approverLabel} for approval`
          : 'Allowance saved',
      })
      queryClient.invalidateQueries({ queryKey: ['employee-allowances', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['pay-approvals'] })
      onClose()
    },
    onError: (err: ApiError) =>
      toast({ title: 'Failed to save allowance', description: errText(err), variant: 'destructive' }),
  })

  const isIncrease = !current || amount > Number(current.amount)
  const valid =
    !!typeId &&
    amount > 0 &&
    note.trim().length >= 3 &&
    startMonth >= ALLOWANCES_FROM_MONTH &&
    (!endMonth || endMonth >= startMonth)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{current ? `Change ${current.type.name}` : 'Add allowance'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Allowance type</Label>
            <Select value={typeId} onValueChange={setTypeId} disabled={!!current}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {types
                  .filter((t) => t.isActive || t.id === typeId)
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.proration === 'ATTENDANCE' ? ' (by attendance)' : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="allowance-amount">Monthly amount</Label>
            <PKRInput id="allowance-amount" value={amount} onChange={setAmount} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="allowance-from">From month</Label>
              <Input
                id="allowance-from"
                type="month"
                min={ALLOWANCES_FROM_MONTH}
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="allowance-to">To month (optional)</Label>
              <Input
                id="allowance-to"
                type="month"
                min={startMonth}
                value={endMonth}
                onChange={(e) => setEndMonth(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave &quot;To month&quot; empty for a regular allowance. For a one-off (e.g. Salary
            Difference) set the same month in both.
          </p>
          <div className="space-y-1">
            <Label htmlFor="allowance-note">What is it for? *</Label>
            <Textarea id="allowance-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {needsApproval && isIncrease ? (
            <ApproverSelect value={approver} onChange={setApprover} />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || (needsApproval && isIncrease && !approver) || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {needsApproval && isIncrease ? 'Send for approval' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EndAllowanceDialog({ row, onClose }: { row: EmployeeAllowance; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [endMonth, setEndMonth] = useState(thisMonth())
  const mutation = useMutation({
    mutationFn: () => allowancesApi.end(row.id, endMonth),
    onSuccess: () => {
      toast({ title: `${row.type.name} ends after ${monthText(`${endMonth}-01`)}` })
      queryClient.invalidateQueries({ queryKey: ['employee-allowances', row.employeeId] })
      onClose()
    },
    onError: (err: ApiError) =>
      toast({ title: 'Failed to end allowance', description: errText(err), variant: 'destructive' }),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>End {row.type.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="allowance-end">Last month it is paid</Label>
          <Input
            id="allowance-end"
            type="month"
            value={endMonth}
            onChange={(e) => setEndMonth(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Choosing a month before it starts removes it completely.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!endMonth || mutation.isPending} onClick={() => mutation.mutate()}>
            End allowance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
