import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Pencil } from 'lucide-react'
import { advanceLoanApi } from '@/api/endpoints/advanceLoan'
import { incentivesApi } from '@/api/endpoints/incentives'
import { payrollApi } from '@/api/endpoints/payroll'
import { EditPayrollDialog } from '@/components/employees/EditPayrollDialog'
import { StatusBadge } from '@/components/employees/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Incentive, PayrollEntry, StipendRecord } from '@/types'

const PAGE_SIZE = 12

function money(value: number | string | null | undefined): string {
  if (value == null || value === '') return '—'
  return `PKR ${Number(value).toLocaleString('en-PK')}`
}

type EmployeePayrollTabProps = {
  employeeId: string
  joiningDate: string
  stipendRecords?: StipendRecord[]
  canEdit?: boolean
  onUpdated?: () => void
}

export function EmployeePayrollTab({
  employeeId,
  joiningDate,
  stipendRecords = [],
  canEdit = false,
  onUpdated,
}: EmployeePayrollTabProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [historyPage, setHistoryPage] = useState(0)

  const latestStipend = stipendRecords[0]

  const totalDeductions = useMemo(() => {
    if (!latestStipend) return 0
    return (
      Number(latestStipend.loanDeduction ?? 0) +
      Number(latestStipend.advanceDeduction ?? 0) +
      Number(latestStipend.fineDeduction ?? 0) +
      Number(latestStipend.healthDeduction ?? 0)
    )
  }, [latestStipend])

  const { data: advanceLoans = [], isLoading: loadingAdvanceLoans } = useQuery(
    {
      queryKey: ['advance-loan', employeeId],
      queryFn: () => advanceLoanApi.getByEmployee(employeeId),
      enabled: !!employeeId,
    },
  )

  const { data: payrollHistory = [], isLoading: loadingPayroll } = useQuery({
    queryKey: ['payroll-history', employeeId],
    queryFn: () => payrollApi.getHistory(employeeId),
    enabled: !!employeeId,
  })

  const { data: incentives = [], isLoading: loadingIncentives } = useQuery({
    queryKey: ['payroll-incentives', employeeId],
    queryFn: () => incentivesApi.getByEmployee(employeeId),
    enabled: !!employeeId,
  })

  const historySlice = (payrollHistory as PayrollEntry[]).slice(
    historyPage * PAGE_SIZE,
    (historyPage + 1) * PAGE_SIZE,
  )
  const totalHistoryPages = Math.ceil(
    (payrollHistory as PayrollEntry[]).length / PAGE_SIZE,
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-lg">Current Stipend Record</CardTitle>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit Payroll
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm">
            <span className="text-text-secondary">Joining Date: </span>
            <span className="font-medium">
              {joiningDate
                ? format(new Date(joiningDate), 'dd/MM/yyyy')
                : '—'}
            </span>
          </p>
          {!latestStipend ? (
            <p className="text-sm text-text-secondary">No stipend record found</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs text-text-secondary">Basic Stipend</p>
                  <p className="font-medium">{money(latestStipend.basicStipend)}</p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs text-text-secondary">Allowances</p>
                  <p className="font-medium">{money(latestStipend.allowances)}</p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs text-text-secondary">Reward</p>
                  <p className="font-medium">{money(latestStipend.reward)}</p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs text-text-secondary">Progress Reward</p>
                  <p className="font-medium">
                    {money(latestStipend.progressReward)}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs text-text-secondary">Fuel Allowance</p>
                  <p className="font-medium">
                    {money(latestStipend.fuelAllowance)}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs text-text-secondary">Lumpsum Total</p>
                  <p className="text-2xl font-bold">
                    {money(latestStipend.lumpsumTotal)}
                  </p>
                </div>
              </div>

              <h4 className="mb-3 mt-6 font-semibold">Deductions</h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs text-text-secondary">Loan Deduction</p>
                  <p className="font-medium">
                    {money(latestStipend.loanDeduction)}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs text-text-secondary">
                    Advance Deduction
                  </p>
                  <p className="font-medium">
                    {money(latestStipend.advanceDeduction)}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs text-text-secondary">Fine Deduction</p>
                  <p className="font-medium">
                    {money(latestStipend.fineDeduction)}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs text-text-secondary">
                    Health Deduction
                  </p>
                  <p className="font-medium">
                    {money(latestStipend.healthDeduction)}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4 sm:col-span-2">
                  <p className="text-xs text-text-secondary">Total Deductions</p>
                  <p className="text-lg font-semibold text-red-600">
                    {money(totalDeductions)}
                  </p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <EditPayrollDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          employeeId={employeeId}
          joiningDate={joiningDate}
          latestStipend={latestStipend}
          onSuccess={() => onUpdated?.()}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Advance & Loan Requests</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingAdvanceLoans ? (
            <div className="space-y-2 p-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advanceLoans.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-text-secondary">
                      No advance or loan requests
                    </TableCell>
                  </TableRow>
                ) : (
                  advanceLoans.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell>{req.type}</TableCell>
                      <TableCell>{money(req.amount)}</TableCell>
                      <TableCell className="max-w-[240px] truncate" title={req.reason}>
                        {req.reason}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={req.status} />
                      </TableCell>
                      <TableCell>
                        {format(new Date(req.createdAt), 'dd/MM/yyyy')}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Payroll History</CardTitle>
          {totalHistoryPages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <button
                type="button"
                className="text-primary disabled:opacity-40"
                disabled={historyPage === 0}
                onClick={() => setHistoryPage((p) => p - 1)}
              >
                Previous
              </button>
              <span className="text-text-secondary">
                Page {historyPage + 1} of {totalHistoryPages}
              </span>
              <button
                type="button"
                className="text-primary disabled:opacity-40"
                disabled={historyPage >= totalHistoryPages - 1}
                onClick={() => setHistoryPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {loadingPayroll ? (
            <div className="space-y-2 p-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Basic</TableHead>
                  <TableHead>Deductions</TableHead>
                  <TableHead>Net</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historySlice.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-text-secondary">
                      No payroll history
                    </TableCell>
                  </TableRow>
                ) : (
                  historySlice.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.month}</TableCell>
                      <TableCell>{entry.year}</TableCell>
                      <TableCell>{money(entry.basicStipend)}</TableCell>
                      <TableCell>{money(entry.totalDeductions)}</TableCell>
                      <TableCell className="font-medium">
                        {money(entry.netStipend)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={entry.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Incentives</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingIncentives ? (
            <div className="space-y-2 p-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Added By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(incentives as Incentive[]).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-text-secondary">
                      No incentives recorded
                    </TableCell>
                  </TableRow>
                ) : (
                  (incentives as Incentive[]).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.month}</TableCell>
                      <TableCell>{item.year}</TableCell>
                      <TableCell className="font-medium text-green-600">
                        {money(item.amount)}
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate" title={item.reason}>
                        {item.reason}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.addedBy.slice(0, 8)}…
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
