import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { incentivesApi } from '@/api/endpoints/incentives'
import type { EmployeeApproverTarget } from '@/api/endpoints/employeeOnboarding'
import { allowancesApi, isPendingApproval } from '@/api/endpoints/payApprovals'
import { ApproverSelect, useNeedsPayApproval } from '@/components/payroll/ApproverSelect'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
import { PKRInput } from '@/components/common/PKRInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { toast } from '@/hooks/use-toast'
import type { Incentive } from '@/types'
import { formatPKR } from '@/lib/stipendUtils'

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const currentYear = new Date().getFullYear()
const YEARS = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i)

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: unknown) => {
  const msg = (err as ApiError).response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

/**
 * Like Add Deduction: one amount box per incentive type (nature), empty
 * boxes skipped. Finance can add a new type right here. Each filled type is
 * saved as its own incentive (sent for approval when the user is not an
 * executive), so the slip shows one line per type after approval.
 */
export function AddIncentivesForm({
  defaultEmployeeId,
  defaultMonth,
  defaultYear,
  onDone,
  onCancel,
  onEdit,
}: {
  defaultEmployeeId?: string
  defaultMonth: number
  defaultYear: number
  onDone: () => void
  onCancel: () => void
  /** Open a saved incentive of this month for editing. */
  onEdit?: (incentive: Incentive) => void
}) {
  const queryClient = useQueryClient()
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId ?? '')
  const [month, setMonth] = useState(defaultMonth)
  const [year, setYear] = useState(defaultYear)
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const [newType, setNewType] = useState('')
  const needsApproval = useNeedsPayApproval()
  const [approver, setApprover] = useState<EmployeeApproverTarget>()

  const { data: types = [] } = useQuery({
    queryKey: ['incentive-types'],
    queryFn: allowancesApi.listIncentiveTypes,
  })
  const { data: existing = [] } = useQuery({
    queryKey: ['incentives', { employeeId, month, year }],
    queryFn: () => incentivesApi.getAll({ employeeId, month, year }),
    enabled: !!employeeId,
  })
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => incentivesApi.delete(id),
    onSuccess: () => {
      toast({ title: 'Incentive deleted' })
      setDeleteId(null)
      queryClient.invalidateQueries({ queryKey: ['incentives'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (err) =>
      toast({ title: 'Failed to delete', description: errText(err), variant: 'destructive' }),
  })

  const active = types.filter((t) => t.isActive)
  const items = active.filter((t) => (amounts[t.id] ?? 0) > 0)
  const total = items.reduce((s, t) => s + amounts[t.id], 0)

  const addType = useMutation({
    mutationFn: () => allowancesApi.createIncentiveType({ name: newType.trim() }),
    onSuccess: (t) => {
      toast({ title: `Incentive type "${t.name}" added` })
      setNewType('')
      queryClient.invalidateQueries({ queryKey: ['incentive-types'] })
    },
    onError: (err) =>
      toast({ title: 'Could not add type', description: errText(err), variant: 'destructive' }),
  })

  const save = useMutation({
    mutationFn: async () => {
      let pending = 0
      let approverLabel = ''
      for (const t of items) {
        const res = await incentivesApi.create({
          employeeId,
          month,
          year,
          typeId: t.id,
          amount: amounts[t.id],
          reason: note.trim() || undefined,
          approverTarget: approver,
        })
        if (isPendingApproval(res)) {
          pending++
          approverLabel = res.approverLabel
        }
      }
      return { pending, approverLabel }
    },
    onSuccess: ({ pending, approverLabel }) => {
      toast({
        title: pending
          ? `${pending} incentive${pending > 1 ? 's' : ''} sent to ${approverLabel} for approval`
          : `${items.length} incentive${items.length > 1 ? 's' : ''} added`,
      })
      setAmounts({})
      setNote('')
      queryClient.invalidateQueries({ queryKey: ['incentives'] })
      queryClient.invalidateQueries({ queryKey: ['pay-approvals'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      onDone()
    },
    onError: (err) => {
      // Types saved before the failure stay; refresh so the lists show them.
      queryClient.invalidateQueries({ queryKey: ['incentives'] })
      queryClient.invalidateQueries({ queryKey: ['pay-approvals'] })
      toast({ title: 'Failed to add incentive', description: errText(err), variant: 'destructive' })
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (items.length) save.mutate()
      }}
      className="space-y-4"
    >
      {!defaultEmployeeId ? (
        <EmployeeSearchSelect value={employeeId} onChange={(id) => setEmployeeId(id)} />
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Month *</Label>
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {new Date(2000, m - 1).toLocaleString('en', { month: 'long' })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Year *</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {employeeId && existing.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Already added this month</p>
          <ul className="divide-y divide-border">
            {existing.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{formatPKR(Number(i.amount))}</span>
                  <span className="ml-2 truncate text-text-secondary">
                    {i.type?.name ?? i.reason}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1">
                  {onEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Edit incentive"
                      onClick={() => onEdit(i)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    aria-label="Delete incentive"
                    onClick={() => setDeleteId(i.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="text-sm font-medium">Incentive by nature</p>
        <p className="text-xs text-text-secondary">
          Enter an amount against each type that applies; empty boxes are skipped.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {active.map((t) => (
          <div key={t.id} className="space-y-1">
            <Label htmlFor={`incentive-${t.id}`}>{t.name}</Label>
            <PKRInput
              id={`incentive-${t.id}`}
              value={amounts[t.id] ?? 0}
              onChange={(v) => setAmounts((prev) => ({ ...prev, [t.id]: v }))}
            />
          </div>
        ))}
        {active.length === 0 ? (
          <p className="text-sm text-text-secondary">No incentive types yet. Add one below.</p>
        ) : null}
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="new-incentive-type">New type (field)</Label>
          <Input
            id="new-incentive-type"
            value={newType}
            placeholder="e.g. Admin, Private Room"
            onChange={(e) => setNewType(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={newType.trim().length < 2 || addType.isPending}
          onClick={() => addType.mutate()}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add field
        </Button>
      </div>

      <div className="space-y-1">
        <Label htmlFor="incentive-note">Note (optional, printed on the payslip next to the type)</Label>
        <Textarea
          id="incentive-note"
          rows={2}
          value={note}
          placeholder="e.g. ward shifting, September progress"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {needsApproval ? (
        <ApproverSelect value={approver} onChange={setApprover} id="incentives-approver" />
      ) : (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Added straight to the employee&apos;s payroll for the selected month.
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">
          Total: <span className="font-medium text-foreground">{formatPKR(total)}</span>
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              save.isPending || !items.length || !employeeId || (needsApproval && !approver)
            }
          >
            {save.isPending ? 'Saving...' : needsApproval ? 'Send for approval' : 'Add Incentive'}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Incentive"
        description="Are you sure you want to delete this incentive? This will reverse the payroll allowance."
        confirmLabel="Delete"
        confirmVariant="destructive"
        loading={remove.isPending}
        onConfirm={() => deleteId && remove.mutate(deleteId)}
        onCancel={() => setDeleteId(null)}
      />
    </form>
  )
}
