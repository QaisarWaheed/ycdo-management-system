import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Clock, Pencil } from 'lucide-react'
import { advanceLoanApi } from '@/api/endpoints/advanceLoan'
import { incentivesApi } from '@/api/endpoints/incentives'
import { payrollApi } from '@/api/endpoints/payroll'
import { EditPayrollDialog } from '@/components/employees/EditPayrollDialog'
import { StatusBadge } from '@/components/employees/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'
import type { Incentive, PayrollEntry, StipendRecord } from '@/types'

const PAGE_SIZE = 12
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function money(value: number | string | null | undefined): string {
  if (value == null || value === '') return '—'
  return `PKR ${Number(value).toLocaleString('en-PK')}`
}

function apiErrorMessage(err: unknown, fallback = 'Error'): string {
  const msg = (
    err as { response?: { data?: { message?: string | string[] } } }
  )?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(', ')
  if (msg) return String(msg)
  return fallback
}

type EmployeePayrollTabProps = {
  employeeId: string
  joiningDate: string
  stipendRecords?: StipendRecord[]
  canEdit?: boolean
  canApplyOvertime?: boolean
  onUpdated?: () => void
}

export function EmployeePayrollTab({
  employeeId,
  joiningDate,
  stipendRecords = [],
  canEdit = false,
  canApplyOvertime = false,
  onUpdated,
}: EmployeePayrollTabProps) {
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [historyPage, setHistoryPage] = useState(0)
  const now = new Date()
  const [otMonth, setOtMonth] = useState(now.getMonth() + 1)
  const [otYear, setOtYear] = useState(now.getFullYear())

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

  const { data: advanceLoans = [], isLoading: loadingAdvanceLoans } = useQuery({
    queryKey: ['advance-loan', employeeId],
    queryFn: () => advanceLoanApi.getByEmployee(employeeId),
    enabled: !!employeeId,
  })

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

  const {
    data: overtimePreview,
    isLoading: loadingOtPreview,
    isError: otPreviewError,
    error: otPreviewErr,
  } = useQuery({
    queryKey: ['payroll-overtime-preview', employeeId, otMonth, otYear],
    queryFn: () => payrollApi.getOvertimePreview(employeeId, otMonth, otYear),
    enabled: !!employeeId && canApplyOvertime,
  })

  const applyOtMutation = useMutation({
    mutationFn: () =>
      payrollApi.applyOvertime({
        employeeId,
        month: otMonth,
        year: otYear,
      }),
    onSuccess: () => {
      toast({ title: 'Overtime applied to payroll' })
      queryClient.invalidateQueries({
        queryKey: ['payroll-history', employeeId],
      })
      queryClient.invalidateQueries({
        queryKey: ['payroll-overtime-preview', employeeId],
      })
      onUpdated?.()
    },
    onError: (err: {
      response?: { data?: { message?: string | string[] } }
    }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to apply overtime',
        description: Array.isArray(msg)
          ? msg.join(', ')
          : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const historySlice = (payrollHistory as PayrollEntry[]).slice(
    historyPage * PAGE_SIZE,
    (historyPage + 1) * PAGE_SIZE,
  )
  const totalHistoryPages = Math.ceil(
    (payrollHistory as PayrollEntry[]).length / PAGE_SIZE,
  )

  const yearOptions = useMemo(() => {
    const years = new Set<number>([otYear, now.getFullYear()])
    for (const entry of payrollHistory as PayrollEntry[]) {
      years.add(entry.year)
    }
    return [...years].sort((a, b) => b - a)
  }, [otYear, payrollHistory])

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

      {canApplyOvertime && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5" />
              Apply Overtime
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-text-secondary">
              Overtime pay uses this employee&apos;s base stipend and monthly
              working hours (duty hours × days in month). All recorded overtime
              for the selected month is included; pay is added only when you
              click Apply Overtime.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Month</Label>
                <Select
                  value={String(otMonth)}
                  onValueChange={(v) => setOtMonth(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((label, index) => (
                      <SelectItem key={label} value={String(index + 1)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Year</Label>
                <Select
                  value={String(otYear)}
                  onValueChange={(v) => setOtYear(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {loadingOtPreview ? (
              <Skeleton className="h-28 w-full" />
            ) : otPreviewError ? (
              <p className="text-sm text-destructive">
                Could not load overtime preview:{' '}
                {apiErrorMessage(otPreviewErr)}. Redeploy the API if this
                endpoint is missing.
              </p>
            ) : overtimePreview ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <p className="text-xs text-text-secondary">
                    Overtime this month
                  </p>
                  <p className="text-2xl font-bold text-primary">
                    {overtimePreview.overtimeMinutes.toLocaleString()} minutes
                  </p>
                  <p className="mt-1 text-sm text-text-secondary">
                    {overtimePreview.overtimeHours.toFixed(2)} hours
                    {(overtimePreview.pendingOvertimeMinutes ?? 0) > 0
                      ? ` · ${overtimePreview.pendingOvertimeMinutes!.toLocaleString()} pending (included)`
                      : null}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-text-secondary">Hourly Rate</p>
                    <p className="font-semibold">
                      {money(overtimePreview.hourlyRate)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-text-secondary">
                      Monthly Working Hrs
                    </p>
                    <p className="font-semibold">
                      {overtimePreview.monthlyWorkingHours}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-3 sm:col-span-1 col-span-2">
                    <p className="text-xs text-text-secondary">OT Amount</p>
                    <p className="text-lg font-bold text-primary">
                      {money(overtimePreview.amount)}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-secondary">
                No overtime data for this month.
              </p>
            )}

            {overtimePreview?.alreadyApplied && (
              <p className="text-sm text-amber-700">
                Overtime already applied for this month (
                {money(overtimePreview.existingAmount)}). Applying again will
                replace the previous overtime allowance.
              </p>
            )}

            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={
                applyOtMutation.isPending ||
                !overtimePreview ||
                overtimePreview.overtimeMinutes <= 0 ||
                overtimePreview.amount <= 0 ||
                overtimePreview.payrollStatus === 'PROCESSED' ||
                overtimePreview.payrollStatus === 'PAID'
              }
              onClick={() => applyOtMutation.mutate()}
            >
              {applyOtMutation.isPending
                ? 'Applying...'
                : overtimePreview?.alreadyApplied
                  ? 'Re-apply Overtime'
                  : 'Apply Overtime'}
            </Button>
          </CardContent>
        </Card>
      )}

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
                      <TableCell
                        className="max-w-[240px] truncate"
                        title={req.reason}
                      >
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
                  <TableHead>Allowances</TableHead>
                  <TableHead>Deductions</TableHead>
                  <TableHead>Net</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historySlice.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-text-secondary">
                      No payroll history
                    </TableCell>
                  </TableRow>
                ) : (
                  historySlice.map((entry) => {
                    const otAllowance = entry.allowances?.find(
                      (a) => a.type === 'OVERTIME',
                    )
                    return (
                      <TableRow key={entry.id}>
                        <TableCell>
                          {MONTHS[entry.month - 1] ?? entry.month}
                          {otAllowance ? (
                            <p className="text-xs text-text-secondary">
                              OT {money(otAllowance.amount)}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>{entry.year}</TableCell>
                        <TableCell>{money(entry.basicStipend)}</TableCell>
                        <TableCell>{money(entry.totalAllowances)}</TableCell>
                        <TableCell>{money(entry.totalDeductions)}</TableCell>
                        <TableCell className="font-medium">
                          {money(entry.netStipend)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={entry.status} />
                        </TableCell>
                      </TableRow>
                    )
                  })
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
                      <TableCell>
                        {MONTHS[(item.month ?? 1) - 1] ?? item.month}
                      </TableCell>
                      <TableCell>{item.year}</TableCell>
                      <TableCell className="font-medium text-green-600">
                        {money(item.amount)}
                      </TableCell>
                      <TableCell
                        className="max-w-[240px] truncate"
                        title={item.reason}
                      >
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
