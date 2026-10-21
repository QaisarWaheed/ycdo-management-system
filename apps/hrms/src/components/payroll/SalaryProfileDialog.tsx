import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import api from '@/api/axios'
import { AssignAllowanceDialog } from '@/components/payroll/EmployeeAllowancesPanel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/hooks/useAuth'
import { resolveFileUrl } from '@/lib/resolveFileUrl'
import { AddIncentiveDialog } from '@/pages/incentives/AddIncentiveDialog'

interface SalaryProfile {
  employee: {
    id: string
    fullName: string
    employeeCode: string
    photoUrl: string | null
    cnic: string | null
    phone: string | null
    currentDesignation: string | null
    status: string
    joiningDate: string
    payPackageVerifiedAt: string | null
    currentBranch: { name: string } | null
    currentDepartment: { name: string } | null
  }
  month: { month: number; year: number }
  package: {
    basicStipend: number
    lumpsumTotal: number | null
    effectiveFrom: string
    allowances: Array<{ name: string; amount: number }>
  } | null
  previousMonthIncentives: {
    month: number
    year: number
    total: number
    items: Array<{ name: string; amount: number; reason: string }>
  }
  attendance: Record<string, number> | null
  discipline: Record<string, number>
  doctorPerformance: Array<{
    month: number
    year: number
    opdPatients: number
    indoorPatients: number
    surgeries: number
    labTests: number
    collection: number
  }>
  loans: Array<{ id: string; kind: string; amount: number; monthlyInstallment: number; remaining: number }>
  lastMonths: Array<{
    month: number
    year: number
    status: string
    basic: number
    allowances: number
    incentives: number
    fines: number
    otherDeductions: number
    net: number
  }>
}

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`
const monthName = (m: number, y: number) =>
  new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'short', year: 'numeric' })
/** camelCase (missingCheckout) or ENUM_CASE (SHOW_CAUSE) key → plain words. */
const words = (k: string) =>
  (/^[A-Z_]+$/.test(k) ? k.replace(/_/g, ' ') : k.replace(/([A-Z])/g, ' $1')).toLowerCase().trim()

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-xs font-semibold uppercase text-text-secondary">{title}</p>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

/** Everything Finance or an approver needs about one employee's pay, on one page. */
export function SalaryProfileDialog({
  employeeId,
  open,
  onOpenChange,
}: {
  employeeId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const canAdd = useAuth().hasRole(['PAYROLL_OFFICER', 'FOUNDER', 'CHAIRMAN', 'PRESIDENT', 'SUPER_ADMIN'])
  const [addIncentive, setAddIncentive] = useState(false)
  const [addAllowance, setAddAllowance] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['salary-profile', employeeId],
    queryFn: () => api.get<unknown, SalaryProfile>(`/payroll/employee/${employeeId}/salary-profile`),
    enabled: open,
  })
  const e = data?.employee
  const photo = resolveFileUrl(e?.photoUrl)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Salary details</DialogTitle>
        </DialogHeader>
        {isLoading || !data || !e ? (
          <p className="text-sm text-text-secondary">Loading…</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-start gap-4">
              {photo ? (
                <img src={photo} alt="" className="h-24 w-24 rounded-lg object-cover" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-gray-100 text-2xl font-semibold">
                  {e.fullName.charAt(0)}
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-lg font-semibold">
                  {e.fullName} <span className="text-sm font-normal text-text-secondary">({e.employeeCode})</span>
                </p>
                <p className="text-sm">
                  {e.currentDesignation ?? '—'} · {e.currentDepartment?.name ?? '—'} · {e.currentBranch?.name ?? '—'}
                </p>
                <p className="text-sm text-text-secondary">
                  {e.status} · joined {format(new Date(e.joiningDate), 'dd MMM yyyy')}
                  {e.cnic ? ` · CNIC ${e.cnic}` : ''}
                  {e.phone ? ` · ${e.phone}` : ''}
                </p>
                <p className="text-xs">
                  {e.payPackageVerifiedAt
                    ? `Package verified by Finance on ${e.payPackageVerifiedAt.slice(0, 10)}`
                    : 'Package not verified yet'}
                </p>
              </div>
              {canAdd ? (
                <div className="flex flex-col gap-2">
                  <Button size="sm" onClick={() => setAddIncentive(true)}>
                    Add incentive
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAddAllowance(true)}>
                    Add allowance
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Box title="Current package">
                {data.package ? (
                  <div className="space-y-1">
                    <Row label="Basic stipend" value={pkr(data.package.basicStipend)} />
                    {data.package.allowances.map((a) => (
                      <Row key={a.name} label={a.name} value={pkr(a.amount)} />
                    ))}
                    <Row
                      label="Lumpsum"
                      value={data.package.lumpsumTotal != null ? pkr(data.package.lumpsumTotal) : '—'}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-text-secondary">No package</p>
                )}
              </Box>
              <Box
                title={`Previous month incentive (${monthName(
                  data.previousMonthIncentives.month,
                  data.previousMonthIncentives.year,
                )})`}
              >
                <p className="text-2xl font-semibold">{pkr(data.previousMonthIncentives.total)}</p>
                {data.previousMonthIncentives.items.map((i, n) => (
                  <Row key={n} label={i.name} value={pkr(i.amount)} />
                ))}
              </Box>
              <Box title={`Attendance (${monthName(data.month.month, data.month.year)})`}>
                {data.attendance ? (
                  <div className="space-y-1">
                    {Object.entries(data.attendance).map(([k, v]) => (
                      <Row key={k} label={words(k)} value={v} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-text-secondary">Not available</p>
                )}
              </Box>
            </div>

            <Box title="Last 3 salaries">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-text-secondary">
                      <th className="py-1">Month</th>
                      <th>Basic</th>
                      <th>Allowances</th>
                      <th>Incentives</th>
                      <th>Deductions</th>
                      <th>Net</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lastMonths.map((m) => (
                      <tr key={`${m.year}-${m.month}`} className="border-t border-border">
                        <td className="py-1">{monthName(m.month, m.year)}</td>
                        <td>{pkr(m.basic)}</td>
                        <td>{pkr(m.allowances)}</td>
                        <td>{pkr(m.incentives)}</td>
                        <td>{pkr(m.fines + m.otherDeductions)}</td>
                        <td className="font-semibold">{pkr(m.net)}</td>
                        <td>{m.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Box>

            <div className="grid gap-3 md:grid-cols-3">
              <Box title="Discipline (letters sent)">
                {Object.keys(data.discipline).length ? (
                  Object.entries(data.discipline).map(([k, v]) => <Row key={k} label={words(k)} value={v} />)
                ) : (
                  <p className="text-sm text-text-secondary">None</p>
                )}
              </Box>
              <Box title="Doctor performance">
                {data.doctorPerformance.length ? (
                  data.doctorPerformance.map((d) => (
                    <Row
                      key={`${d.year}-${d.month}`}
                      label={monthName(d.month, d.year)}
                      value={`${d.opdPatients} OPD · ${d.surgeries} surgeries · ${pkr(d.collection)}`}
                    />
                  ))
                ) : (
                  <p className="text-sm text-text-secondary">No records</p>
                )}
              </Box>
              <Box title="Loans & advances">
                {data.loans.length ? (
                  data.loans.map((l) => (
                    <Row
                      key={l.id}
                      label={`${l.kind === 'ADVANCE' ? 'Advance' : 'Loan'} ${pkr(l.amount)}`}
                      value={`${pkr(l.remaining)} left · ${pkr(l.monthlyInstallment)}/mo`}
                    />
                  ))
                ) : (
                  <p className="text-sm text-text-secondary">None</p>
                )}
              </Box>
            </div>
          </div>
        )}
        <AddIncentiveDialog open={addIncentive} onOpenChange={setAddIncentive} defaultEmployeeId={employeeId} />
        {addAllowance ? (
          <AssignAllowanceDialog employeeId={employeeId} current={null} onClose={() => setAddAllowance(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
