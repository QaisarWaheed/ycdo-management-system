import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { allowancesApi, type EmployeeAllowance } from '@/api/endpoints/payApprovals'
import { incentivesApi } from '@/api/endpoints/incentives'
import { loansApi } from '@/api/endpoints/loans'
import {
  ALLOWANCES_FROM_MONTH,
  AssignAllowanceDialog,
} from '@/components/payroll/EmployeeAllowancesPanel'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'

const MANAGE_ROLES = ['PAYROLL_OFFICER', 'PRESIDENT', 'FOUNDER', 'CHAIRMAN', 'SUPER_ADMIN']
const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`

/** The month the list shows: this month, or the allowance-table start if later. */
function shownMonth() {
  const d = new Date()
  const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  return v < ALLOWANCES_FROM_MONTH ? ALLOWANCES_FROM_MONTH : v
}

/**
 * Every pay component defined in Payroll (Pay Types), with this employee's
 * amount. New types added in Payroll → Pay Types appear here by themselves.
 */
export function PayComponentsSection({ employeeId }: { employeeId: string }) {
  const canManage = useAuth().hasRole(MANAGE_ROLES)
  const month = shownMonth()
  const [editing, setEditing] = useState<{ typeId: string; current: EmployeeAllowance | null }>()
  const { data: types = [] } = useQuery({ queryKey: ['allowance-types'], queryFn: allowancesApi.listTypes })
  const { data: rows = [] } = useQuery({
    queryKey: ['employee-allowances', employeeId],
    queryFn: () => allowancesApi.listForEmployee(employeeId),
  })
  const { data: incentiveTypes = [] } = useQuery({
    queryKey: ['incentive-types'],
    queryFn: allowancesApi.listIncentiveTypes,
  })
  const { data: plans = [] } = useQuery({
    queryKey: ['incentive-plans', employeeId],
    queryFn: () => incentivesApi.plans(employeeId),
  })
  const { data: loans } = useQuery({
    queryKey: ['loans', employeeId],
    queryFn: () => loansApi.forEmployee(employeeId),
  })

  const running = (typeId: string) =>
    rows.filter(
      (r) =>
        r.typeId === typeId &&
        r.startMonth.slice(0, 7) <= month &&
        (!r.endMonth || r.endMonth.slice(0, 7) >= month),
    )
  const activePlans = plans.filter((p) => !p.stoppedAt)
  const activeLoans = (loans?.loans ?? []).filter((l) => l.status === 'APPROVED' && l.remaining > 0)
  const monthLabel = new Date(`${month}-15`).toLocaleString('en-US', { month: 'short', year: 'numeric' })

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div>
        <p className="font-medium">All pay components ({monthLabel})</p>
        <p className="text-xs text-text-secondary">
          Every allowance and incentive type set up in Payroll → Pay Types. Add a new type there and it appears here.
          Changes follow the normal approval rules.
        </p>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-text-secondary">Allowances</p>
        <div className="divide-y divide-border rounded border border-border">
          {types
            .filter((t) => t.isActive)
            .map((t) => {
              const live = running(t.id)
              const total = live.reduce((s, r) => s + Number(r.amount), 0)
              return (
                <div key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    {t.name}
                    {t.proration === 'ATTENDANCE' ? (
                      <span className="ml-1 text-xs text-text-secondary">(by attendance)</span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={total ? 'font-medium' : 'text-text-secondary'}>{total ? pkr(total) : '—'}</span>
                    {canManage ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing({ typeId: t.id, current: live.length === 1 ? live[0] : null })}
                      >
                        {total ? 'Change' : 'Set'}
                      </Button>
                    ) : null}
                  </span>
                </div>
              )
            })}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-text-secondary">Recurring incentives</p>
        <div className="divide-y divide-border rounded border border-border">
          {incentiveTypes
            .filter((t) => t.isActive)
            .map((t) => {
              const total = activePlans
                .filter((p) => p.type?.id === t.id)
                .reduce((s, p) => s + Number(p.amount), 0)
              return (
                <div key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{t.name}</span>
                  <span className={total ? 'font-medium' : 'text-text-secondary'}>{total ? pkr(total) : '—'}</span>
                </div>
              )
            })}
        </div>
        <p className="mt-1 text-xs text-text-secondary">Incentives are added from the Incentives section of the Payroll tab.</p>
      </div>

      {activeLoans.length ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-text-secondary">Loan installments</p>
          <div className="divide-y divide-border rounded border border-border">
            {activeLoans.map((l) => (
              <div key={l.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>Loan {pkr(l.amount)} · {pkr(l.remaining)} left</span>
                <span className="font-medium">{pkr(l.monthlyInstallment)} / month</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-text-secondary">Taken from salary automatically (Loans section).</p>
        </div>
      ) : null}

      {editing ? (
        <AssignAllowanceDialog
          employeeId={employeeId}
          current={editing.current}
          defaultTypeId={editing.typeId}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </div>
  )
}
