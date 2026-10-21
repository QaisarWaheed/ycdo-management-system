import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isPendingApproval } from '@/api/endpoints/payApprovals'
import { payrollApi } from '@/api/endpoints/payroll'
import type { EmployeeApproverTarget } from '@/api/endpoints/employeeOnboarding'
import { ApproverSelect, useNeedsPayApproval } from '@/components/payroll/ApproverSelect'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { AddIncentiveDialog } from '@/pages/incentives/AddIncentiveDialog'
import { DEDUCTION_TYPES, type PayrollEntry } from '@/types'

type Kind = 'allowances' | 'deductions' | 'incentives'
type ApiError = { response?: { data?: { message?: string | string[] } } }
const errorText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}
const pkr = (n: number | string) => `PKR ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`
const titleCase = (s: string) => {
  const w = s.replace(/_/g, ' ').toLowerCase()
  return w.charAt(0).toUpperCase() + w.slice(1)
}
/** Internal ids in system row descriptions are not for people. */
const clean = (d?: string | null) =>
  (d ?? '')
    .replace(/^(Letter fine|Loan installment|Advance installment|Medicine pending) \[[^\]]+\]\s*/, '$1 ')
    .trim()

/**
 * The payslip's Allowances, Deductions and Incentives, each opening the
 * month's detail: rows the system adds automatically and rows Finance adds by hand.
 */
export function PayslipComponents({ entry }: { entry: PayrollEntry }) {
  const [open, setOpen] = useState<Kind | null>(null)
  const allowances = (entry.allowances ?? []).filter((a) => !(a.description ?? '').startsWith('Incentive'))
  const incentives = (entry.allowances ?? []).filter((a) => (a.description ?? '').startsWith('Incentive'))
  const deductions = entry.deductions ?? []
  const packageLines = (entry.hourlyBreakdown as { packageAllowanceLines?: Array<{ name: string; amount: number }> } | undefined)
    ?.packageAllowanceLines ?? []
  const sum = (rows: Array<{ amount: number | string }>) => rows.reduce((s, r) => s + Number(r.amount), 0)

  const tiles: Array<{ kind: Kind; label: string; total: number }> = [
    { kind: 'allowances', label: 'Allowances', total: sum(allowances) + sum(packageLines) },
    { kind: 'deductions', label: 'Deductions', total: sum(deductions) },
    { kind: 'incentives', label: 'Incentives', total: sum(incentives) },
  ]

  return (
    <div className="no-print mb-3 grid grid-cols-3 gap-2">
      {tiles.map((t) => (
        <button
          key={t.kind}
          type="button"
          onClick={() => setOpen(t.kind)}
          className="rounded-lg border border-border p-2 text-left hover:bg-gray-50"
        >
          <div className="text-xs text-text-secondary">{t.label}</div>
          <div className="font-semibold">{pkr(t.total)}</div>
          <div className="text-xs text-primary">View details</div>
        </button>
      ))}
      {open ? (
        <ComponentDialog
          kind={open}
          entry={entry}
          rows={
            open === 'deductions'
              ? deductions.map((d) => ({ id: d.id, label: titleCase(d.reason), note: clean(d.description), amount: d.amount }))
              : open === 'incentives'
                ? incentives.map((a) => ({ id: a.id, label: 'Incentive', note: clean(a.description?.replace(/^Incentive:?\s*/, '')), amount: a.amount }))
                : [
                    ...packageLines.map((l, i) => ({ id: `p${i}`, label: l.name, note: 'Monthly package', amount: l.amount })),
                    ...allowances.map((a) => ({ id: a.id, label: titleCase(a.type), note: clean(a.description), amount: a.amount })),
                  ]
          }
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  )
}

function ComponentDialog({
  kind,
  entry,
  rows,
  onClose,
}: {
  kind: Kind
  entry: PayrollEntry
  rows: Array<{ id: string; label: string; note: string; amount: number | string }>
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const canAdd = useAuth().hasRole(['PAYROLL_OFFICER', 'FOUNDER', 'CHAIRMAN', 'PRESIDENT', 'SUPER_ADMIN'])
  const needsApproval = useNeedsPayApproval()
  const editable = entry.status === 'PENDING'
  const [reason, setReason] = useState('OTHER')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [approver, setApprover] = useState<EmployeeApproverTarget>()
  const [incentiveOpen, setIncentiveOpen] = useState(false)
  const title = { allowances: 'Allowances', deductions: 'Deductions', incentives: 'Incentives' }[kind]
  const period = new Date(Date.UTC(entry.year, entry.month - 1, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric' })

  const add = useMutation({
    mutationFn: () =>
      kind === 'deductions'
        ? payrollApi.addDeduction({ payrollEntryId: entry.id, reason, amount: Number(amount), description: description.trim() })
        : payrollApi.addAllowance({
            payrollEntryId: entry.id,
            type: 'CUSTOM',
            amount: Number(amount),
            description: description.trim(),
            ...(needsApproval ? { approverTarget: approver } : {}),
          }),
    onSuccess: (res) => {
      toast({ title: isPendingApproval(res) ? `Sent to ${res.approverLabel} for approval` : 'Added to this month' })
      setAmount('')
      setDescription('')
      queryClient.invalidateQueries({ queryKey: ['payroll-entry-full', entry.id] })
      queryClient.invalidateQueries({ queryKey: ['payroll-history'] })
    },
    onError: (err: ApiError) => toast({ title: 'Could not add', description: errorText(err), variant: 'destructive' }),
  })
  const valid =
    Number(amount) > 0 && description.trim().length >= 3 && (kind !== 'allowances' || !needsApproval || !!approver)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {title} — {period}
          </DialogTitle>
        </DialogHeader>
        <div className="divide-y divide-border rounded border border-border">
          {rows.length === 0 ? (
            <p className="p-3 text-sm text-text-secondary">Nothing this month</p>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-2 p-2 text-sm">
                <div>
                  <div className="font-medium">{r.label}</div>
                  {r.note ? <div className="text-xs text-text-secondary">{r.note}</div> : null}
                </div>
                <div className="font-semibold">{pkr(r.amount)}</div>
              </div>
            ))
          )}
        </div>
        {kind === 'deductions' ? (
          <p className="text-xs text-text-secondary">
            Attendance, loan, advance and Medicine Pending deductions are added automatically.
          </p>
        ) : null}

        {canAdd && editable ? (
          kind === 'incentives' ? (
            <Button onClick={() => setIncentiveOpen(true)}>Add incentive for {period}</Button>
          ) : (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">Add by hand</p>
              {kind === 'deductions' ? (
                <div className="space-y-1">
                  <Label htmlFor="pc-reason">Type</Label>
                  <select
                    id="pc-reason"
                    className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    {DEDUCTION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="space-y-1">
                <Label htmlFor="pc-amount">Amount (PKR)</Label>
                <Input id="pc-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pc-desc">Description (printed on the slip)</Label>
                <Input id="pc-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              {kind === 'allowances' && needsApproval ? (
                <ApproverSelect value={approver} onChange={setApprover} id="pc-approver" />
              ) : null}
              <Button disabled={!valid || add.isPending} onClick={() => add.mutate()}>
                {add.isPending ? 'Saving...' : kind === 'deductions' ? 'Add deduction' : 'Add allowance'}
              </Button>
            </div>
          )
        ) : !editable ? (
          <p className="text-xs text-text-secondary">This month is {entry.status.toLowerCase()}; changes go through a salary correction.</p>
        ) : null}
        <AddIncentiveDialog
          open={incentiveOpen}
          onOpenChange={setIncentiveOpen}
          defaultEmployeeId={entry.stipendRecord?.employee?.id}
          defaultMonth={entry.month}
          defaultYear={entry.year}
        />
      </DialogContent>
    </Dialog>
  )
}
