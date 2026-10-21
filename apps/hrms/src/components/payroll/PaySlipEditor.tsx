import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseFormReturn } from 'react-hook-form'
import type { EmployeeApproverTarget } from '@/api/endpoints/employeeOnboarding'
import { allowancesApi, isPendingApproval } from '@/api/endpoints/payApprovals'
import { incentivesApi } from '@/api/endpoints/incentives'
import { payrollApi } from '@/api/endpoints/payroll'
import { ALLOWANCES_FROM_MONTH } from '@/components/payroll/EmployeeAllowancesPanel'
import { ApproverSelect, useNeedsPayApproval } from '@/components/payroll/ApproverSelect'
import { Input } from '@/components/ui/input'
import { DEDUCTION_TYPES, isManualDeduction } from '@/types'

/** Taken from salary by the system (Loans, Medicine Pending log, attendance): not typed here. */
const AUTOMATIC = ['LOAN', 'ADVANCE', 'MEDICINE_PENDING']
const LEGACY_FIELDS = ['allowances', 'reward', 'progressReward', 'fuelAllowance'] as const
type LegacyField = (typeof LEGACY_FIELDS)[number]
const isLegacy = (f?: string | null): f is LegacyField => LEGACY_FIELDS.includes(f as LegacyField)

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`
const thisMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const prevMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`
}
const num = (v: string | undefined) => Number(v) || 0

/**
 * Edit Payroll laid out like the salary slip: every allowance, incentive and
 * deduction type with an amount box. Filled boxes are saved, empty ones skipped.
 * Before Nov 2026 the four old package allowances are package fields, so their
 * boxes edit the form directly and save with the package.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function usePaySlipDraft(employeeId: string, form: UseFormReturn<any>) {
  const queryClient = useQueryClient()
  const needsApproval = useNeedsPayApproval()
  const [month, setMonth] = useState(thisMonth())
  const [allowance, setAllowance] = useState<Record<string, string>>({})
  const [incentive, setIncentive] = useState<Record<string, string>>({})
  const [deduction, setDeduction] = useState<Record<string, string>>({})
  const [deductionNote, setDeductionNote] = useState<Record<string, string>>({})
  const [incentiveNote, setIncentiveNote] = useState('')
  const [approver, setApprover] = useState<EmployeeApproverTarget>()

  const { data: allowanceTypes = [] } = useQuery({ queryKey: ['allowance-types'], queryFn: allowancesApi.listTypes })
  const { data: incentiveTypes = [] } = useQuery({
    queryKey: ['incentive-types'],
    queryFn: allowancesApi.listIncentiveTypes,
  })
  const { data: rows = [] } = useQuery({
    queryKey: ['employee-allowances', employeeId],
    queryFn: () => allowancesApi.listForEmployee(employeeId),
  })
  const { data: incentives = [] } = useQuery({
    queryKey: ['incentives', 'employee', employeeId],
    queryFn: () => incentivesApi.getByEmployee(employeeId),
  })
  const { data: history = [] } = useQuery({
    queryKey: ['payroll-history', employeeId],
    queryFn: () => payrollApi.getHistory(employeeId),
  })

  const [y, m] = month.split('-').map(Number)
  const packageMonth = month < ALLOWANCES_FROM_MONTH
  const legacyOf = (t: { legacyField?: string | null }) =>
    packageMonth && isLegacy(t.legacyField) ? t.legacyField : null
  const runningRows = (typeId: string) =>
    rows.filter(
      (r) => r.typeId === typeId && r.startMonth.slice(0, 7) <= month && (!r.endMonth || r.endMonth.slice(0, 7) >= month),
    )
  const currentAllowance = (t: { id: string; legacyField?: string | null }) => {
    const legacy = legacyOf(t)
    if (legacy) return Number(form.getValues(legacy)) || 0
    return runningRows(t.id).reduce((s, r) => s + Number(r.amount), 0)
  }
  const entry = history.find((e) => e.month === m && e.year === y && e.status === 'PENDING')
  const monthIncentives = incentives.filter((i) => i.month === m && i.year === y)
  const monthDeductions = (entry?.deductions ?? []).filter(isManualDeduction)

  const allowanceChanges = allowanceTypes
    .filter((t) => t.isActive && !legacyOf(t) && allowance[t.id] !== undefined)
    .filter((t) => num(allowance[t.id]) !== currentAllowance(t))
  const incentiveItems = incentiveTypes.filter((t) => t.isActive && num(incentive[t.id]) > 0)
  const deductionItems = DEDUCTION_TYPES.filter((t) => !AUTOMATIC.includes(t.value) && num(deduction[t.value]) > 0)
  const changed = allowanceChanges.length + incentiveItems.length + deductionItems.length > 0
  const approverNeeded = needsApproval && allowanceChanges.length + incentiveItems.length > 0

  /** Saves every filled box; returns how many went for approval. */
  async function apply(): Promise<{ pending: number; approverLabel: string }> {
    if (approverNeeded && !approver) throw new Error('Choose who approves the allowances / incentives')
    if (deductionItems.length && !entry) {
      throw new Error(`No open (pending) payroll for ${month}; deductions cannot be added to that month`)
    }
    let pending = 0
    let approverLabel = ''
    const count = (res: unknown) => {
      if (isPendingApproval(res)) {
        pending++
        approverLabel = res.approverLabel
      }
    }
    for (const t of allowanceChanges) {
      const amount = num(allowance[t.id])
      if (amount > 0) {
        count(await allowancesApi.assign({ employeeId, typeId: t.id, amount, startMonth: month, approverTarget: approver }))
        continue
      }
      for (const r of runningRows(t.id)) {
        if (r.startMonth.slice(0, 7) >= month) {
          throw new Error(`${t.name} starts in ${month}; end it from the Allowances list instead`)
        }
        count(await allowancesApi.end(r.id, prevMonth(month), approver))
      }
    }
    for (const t of incentiveItems) {
      count(
        await incentivesApi.create({
          employeeId,
          month: m,
          year: y,
          typeId: t.id,
          amount: num(incentive[t.id]),
          reason: incentiveNote.trim() || undefined,
          approverTarget: approver,
        }),
      )
    }
    if (deductionItems.length && entry) {
      await payrollApi.addDeductions({
        payrollEntryId: entry.id,
        items: deductionItems.map((t) => ({
          reason: t.value,
          amount: num(deduction[t.value]),
          description: deductionNote[t.value]?.trim() || t.label,
        })),
      })
    }
    setAllowance({})
    setIncentive({})
    setDeduction({})
    setDeductionNote({})
    setIncentiveNote('')
    for (const key of ['employee-allowances', 'incentives', 'payroll-history', 'pay-approvals', 'payroll']) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
    return { pending, approverLabel }
  }

  return {
    month, setMonth, allowance, setAllowance, incentive, setIncentive, deduction, setDeduction,
    deductionNote, setDeductionNote, incentiveNote, setIncentiveNote, approver, setApprover,
    allowanceTypes, incentiveTypes, currentAllowance, legacyOf, entry, monthIncentives, monthDeductions,
    changed, approverNeeded, apply, form,
  }
}

type Draft = ReturnType<typeof usePaySlipDraft>

function Row({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
      <div className="min-w-0">
        <div>{label}</div>
        {hint ? <div className="text-xs text-text-secondary">{hint}</div> : null}
      </div>
      <Input
        type="number"
        min={0}
        inputMode="numeric"
        aria-label={label}
        className="h-8 w-32 text-right"
        placeholder="—"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase text-text-secondary">{title}</p>
      <div className="divide-y divide-border rounded border border-border">{children}</div>
      {note ? <p className="mt-1 text-xs text-text-secondary">{note}</p> : null}
    </div>
  )
}

export function PaySlipEditor({ draft: d }: { draft: Draft }) {
  const label = new Date(`${d.month}-15`).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  return (
    <div className="space-y-4 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-medium">Salary slip components</p>
          <p className="text-xs text-text-secondary">Write an amount to add it; leave a box empty to skip it.</p>
        </div>
        <label className="text-sm">
          Month{' '}
          <Input
            type="month"
            className="inline-block h-8 w-40"
            value={d.month}
            onChange={(e) => e.target.value && d.setMonth(e.target.value)}
          />
        </label>
      </div>

      <Section title={`Allowances (every month from ${label})`} note="Clearing a box stops that allowance from this month.">
        {d.allowanceTypes
          .filter((t) => t.isActive)
          .map((t) => {
            const legacy = d.legacyOf(t)
            const current = d.currentAllowance(t)
            const value = legacy
              ? String(d.form.watch(legacy) || '')
              : (d.allowance[t.id] ?? (current ? String(current) : ''))
            return (
              <Row
                key={t.id}
                label={t.name}
                hint={t.proration === 'ATTENDANCE' ? 'paid by attendance' : legacy ? 'saved with the package' : undefined}
                value={value}
                onChange={(v) =>
                  legacy
                    ? d.form.setValue(legacy, Number(v) || 0, { shouldDirty: true })
                    : d.setAllowance({ ...d.allowance, [t.id]: v })
                }
              />
            )
          })}
      </Section>

      <Section
        title={`Incentives (${label} only)`}
        note={
          d.monthIncentives.length
            ? `Already this month: ${d.monthIncentives.map((i) => `${i.type?.name ?? 'Incentive'} ${pkr(Number(i.amount))}`).join(', ')}`
            : undefined
        }
      >
        {d.incentiveTypes
          .filter((t) => t.isActive)
          .map((t) => (
            <Row
              key={t.id}
              label={t.name}
              value={d.incentive[t.id] ?? ''}
              onChange={(v) => d.setIncentive({ ...d.incentive, [t.id]: v })}
            />
          ))}
        <div className="px-3 py-1.5">
          <Input
            className="h-8"
            placeholder="Incentive note (printed on the slip, optional)"
            value={d.incentiveNote}
            onChange={(e) => d.setIncentiveNote(e.target.value)}
          />
        </div>
      </Section>

      <Section
        title={`Deductions (${label} only)`}
        note={[
          d.monthDeductions.length
            ? `Already this month: ${d.monthDeductions.map((x) => `${x.description || x.reason} ${pkr(Number(x.amount))}`).join(', ')}.`
            : '',
          'Loan, advance, Medicine Pending, letter fines and attendance are taken automatically.',
          d.entry ? '' : `No open payroll for ${label} yet, so deductions cannot be added to it.`,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {DEDUCTION_TYPES.filter((t) => !AUTOMATIC.includes(t.value)).map((t) => (
          <div key={t.value}>
            <Row
              label={t.label}
              value={d.deduction[t.value] ?? ''}
              onChange={(v) => d.setDeduction({ ...d.deduction, [t.value]: v })}
            />
            {num(d.deduction[t.value]) > 0 ? (
              <div className="px-3 pb-1.5">
                <Input
                  className="h-8"
                  placeholder={`What it is for (printed on the slip; default "${t.label}")`}
                  value={d.deductionNote[t.value] ?? ''}
                  onChange={(e) => d.setDeductionNote({ ...d.deductionNote, [t.value]: e.target.value })}
                />
              </div>
            ) : null}
          </div>
        ))}
      </Section>

      {d.approverNeeded ? <ApproverSelect value={d.approver} onChange={d.setApprover} id="slip-approver" /> : null}
    </div>
  )
}
