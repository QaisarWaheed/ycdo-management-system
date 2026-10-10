import { useCallback, useMemo, useState, Fragment } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { MoreHorizontal, Plus, Printer, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { designationsApi } from '@/api/endpoints/designations'
import { attendanceApi } from '@/api/endpoints/attendance'
import { employeesApi } from '@/api/endpoints/employees'
import { incentivesApi } from '@/api/endpoints/incentives'
import { payrollApi } from '@/api/endpoints/payroll'
import { stipendReceiptsApi } from '@/api/endpoints/stipendReceipts'
import { TablePagination } from '@/components/common/TablePagination'
import { TableRecordCount } from '@/components/common/TableRecordCount'
import { DateInput } from '@/components/common/DateInput'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { StatusBadge } from '@/components/employees/StatusBadge'
import { MonthYearPicker } from '@/components/common/MonthYearPicker'
import { PKRInput } from '@/components/common/PKRInput'
import { PayslipDocument } from '@/components/payroll/PayslipDocument'
import { PayslipPrintSheet } from '@/components/payroll/PayslipPrintSheet'
import type { PayslipSlipData } from '@/lib/payslipSlip'
import {
  buildMonthlyPayrollReportRows,
  exportMonthlyPayrollCsv,
  PayrollReportPrintSection,
  PrintPayrollReportButton,
} from '@/components/payroll/PayrollReportPrint'
import { StipendPackageFields } from '@/components/payroll/StipendPackageFields'
import {
  buildPayslipSlipFromEntry,
} from '@/lib/payslipSlip'
import { calculateLumpsumTotal, DEFAULT_STIPEND_VALUES } from '@/lib/stipendUtils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { EmployeeApproverTarget } from '@/api/endpoints/employeeOnboarding'
import { isPendingApproval } from '@/api/endpoints/payApprovals'
import {
  ApproverSelect,
  useCanEditPay,
  useNeedsPayApproval,
} from '@/components/payroll/ApproverSelect'
import { EmployeeAllowancesPanel } from '@/components/payroll/EmployeeAllowancesPanel'
import { PayTypesTab } from '@/components/payroll/PayTypesTab'
import { PayrollReportsTab } from '@/components/payroll/PayrollReportsTab'
import {
  PayrollChangeHistory,
  PayrollFinalizeDialog,
  useCanFinalizePayroll,
} from '@/components/payroll/PayrollFinalize'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { getApiErrorMessage } from '@/lib/apiErrorMessage'
import { usePagination } from '@/hooks/usePagination'
import { AddIncentiveDialog } from '@/pages/incentives/AddIncentiveDialog'
import { cn } from '@/lib/utils'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import {
  ALLOWANCE_TYPES,
  DEDUCTION_TYPES,
  MANUAL_DEDUCTION_FIELDS,
  type AllowanceType,
  type DeductionType,
  type PayrollDeduction,
  deductionReasonLabel,
  isManualDeduction,
  EMPLOYEE_STATUSES,
  type Employee,
  type EmployeeStatus,
  type PayrollEntry,
  type PayrollStatus,
  type StipendReceipt,
  type StipendStatus,
} from '@/types'

const ALL = 'ALL'

function formatPKR(amount: number | string) {
  return `PKR ${Number(amount).toLocaleString('en-PK')}`
}

function PayrollStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
    PROCESSED: 'bg-blue-100 text-blue-800 border-blue-200',
    PAID: 'bg-green-100 text-green-800 border-green-200',
  }
  return (
    <Badge variant="outline" className={styles[status] ?? ''}>
      {status}
    </Badge>
  )
}

function employeeStatusLabel(status: EmployeeStatus) {
  return status
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ')
}

function DeductionsTable({
  deductions,
  editable,
  onChanged,
}: {
  deductions: PayrollDeduction[]
  editable: boolean
  onChanged: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftReason, setDraftReason] = useState<DeductionType>('OTHER')
  const [draftAmount, setDraftAmount] = useState(0)
  const [draftDescription, setDraftDescription] = useState('')
  const [removing, setRemoving] = useState<PayrollDeduction | null>(null)

  const showError =
    (title: string) =>
    (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title,
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    }

  const saveMutation = useMutation({
    mutationFn: (id: string) =>
      payrollApi.updateDeduction(id, {
        reason: draftReason,
        amount: draftAmount,
        description: draftDescription.trim() || null,
      }),
    onSuccess: () => {
      toast({ title: 'Deduction updated' })
      setEditingId(null)
      onChanged()
    },
    onError: showError('Failed to update deduction'),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => payrollApi.removeDeduction(id),
    onSuccess: () => {
      toast({ title: 'Deduction removed' })
      setRemoving(null)
      onChanged()
    },
    onError: showError('Failed to remove deduction'),
  })

  const startEdit = (d: PayrollDeduction) => {
    setEditingId(d.id)
    setDraftReason(d.reason as DeductionType)
    setDraftAmount(Number(d.amount) || 0)
    setDraftDescription(d.description ?? '')
  }

  const columns = editable ? 4 : 3

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Reason</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Description</TableHead>
            {editable && <TableHead className="w-[150px] text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {deductions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns} className="text-text-secondary">
                No deductions
              </TableCell>
            </TableRow>
          ) : (
            deductions.map((d) =>
              editingId === d.id ? (
                <TableRow key={d.id}>
                  <TableCell className="min-w-[160px]">
                    <Select
                      value={draftReason}
                      onValueChange={(v) => setDraftReason(v as DeductionType)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DEDUCTION_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="min-w-[140px]">
                    <PKRInput value={draftAmount} onChange={setDraftAmount} />
                  </TableCell>
                  <TableCell className="min-w-[160px]">
                    <Input
                      value={draftDescription}
                      onChange={(e) => setDraftDescription(e.target.value)}
                      placeholder="Optional"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        disabled={draftAmount <= 0 || saveMutation.isPending}
                        onClick={() => saveMutation.mutate(d.id)}
                      >
                        {saveMutation.isPending ? 'Saving...' : 'Save'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={d.id}>
                  <TableCell>{deductionReasonLabel(d.reason, d.fineReason)}</TableCell>
                  <TableCell className="text-red-600">{formatPKR(d.amount)}</TableCell>
                  <TableCell>{d.description ?? '—'}</TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      {isManualDeduction(d) ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={editingId !== null}
                            onClick={() => startEdit(d)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:text-red-700"
                            disabled={editingId !== null}
                            onClick={() => setRemoving(d)}
                          >
                            Remove
                          </Button>
                        </div>
                      ) : (
                        <span
                          className="text-xs text-text-secondary"
                          title="Created by attendance or disciplinary records; change it there"
                        >
                          System
                        </span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ),
            )
          )}
        </TableBody>
      </Table>
      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        title="Remove deduction"
        description={
          removing
            ? `Remove ${deductionReasonLabel(removing.reason)} of ${formatPKR(removing.amount)}? It will be added back to net pay.`
            : ''
        }
        confirmLabel="Remove"
        confirmVariant="destructive"
        loading={removeMutation.isPending}
        onConfirm={() => removing && removeMutation.mutate(removing.id)}
      />
    </>
  )
}

function AddDeductionForm({
  payrollEntryId,
  onSuccess,
}: {
  payrollEntryId: string
  onSuccess: () => void
}) {
  const [amounts, setAmounts] = useState<Partial<Record<string, number>>>({})
  const [description, setDescription] = useState('')

  const items = MANUAL_DEDUCTION_FIELDS.flatMap(({ key, reason, fineReason }) => {
    const amount = amounts[key] ?? 0
    return amount > 0
      ? [{ reason, fineReason, amount, description: description.trim() || undefined }]
      : []
  })
  const total = items.reduce((sum, item) => sum + item.amount, 0)

  const mutation = useMutation({
    mutationFn: () => payrollApi.addDeductions({ payrollEntryId, items }),
    onSuccess: () => {
      toast({
        title: items.length === 1 ? 'Deduction added' : `${items.length} deductions added`,
      })
      setAmounts({})
      setDescription('')
      onSuccess()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to add deduction',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (items.length) mutation.mutate()
      }}
      className="space-y-3 border-t border-border pt-4"
    >
      <div>
        <p className="text-sm font-medium">Add Deduction</p>
        <p className="text-xs text-text-secondary">
          Enter an amount against each cause that applies; empty fields are skipped.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MANUAL_DEDUCTION_FIELDS.map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`deduction-${key}`}>{label}</Label>
            <PKRInput
              id={`deduction-${key}`}
              value={amounts[key] ?? 0}
              onChange={(amount) =>
                setAmounts((prev) => ({ ...prev, [key]: amount }))
              }
            />
          </div>
        ))}
      </div>
      <div className="space-y-1">
        <Label htmlFor="deduction-description">
          What is it for? <span className="text-destructive">*</span> (printed on the payslip)
        </Label>
        <Textarea
          id="deduction-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">
          Total: <span className="font-medium text-foreground">{formatPKR(total)}</span>
        </p>
        <Button
          type="submit"
          disabled={mutation.isPending || !items.length || description.trim().length < 3}
          size="sm"
        >
          {mutation.isPending ? 'Adding...' : 'Add Deduction'}
        </Button>
      </div>
    </form>
  )
}

function AddAllowanceForm({
  payrollEntryId,
  hourlyRate,
  onSuccess,
}: {
  payrollEntryId: string
  hourlyRate?: number
  onSuccess: () => void
}) {
  const [type, setType] = useState<AllowanceType>('CUSTOM')
  const [description, setDescription] = useState('')
  const [hours, setHours] = useState<number | undefined>()
  const [amount, setAmount] = useState(0)
  const needsApproval = useNeedsPayApproval()
  const [approver, setApprover] = useState<EmployeeApproverTarget>()

  const hasHours = hours != null && hours > 0
  const calculatedAmount =
    hasHours && hourlyRate && hourlyRate > 0
      ? Math.round(hours * hourlyRate * 100) / 100
      : null
  const canSubmit = hasHours || amount > 0

  const mutation = useMutation({
    mutationFn: () =>
      payrollApi.addAllowance({
        payrollEntryId,
        type,
        description: description || undefined,
        ...(hasHours ? { hours } : { amount }),
        approverTarget: approver,
      }),
    onSuccess: (res) => {
      toast({
        title: isPendingApproval(res)
          ? `Sent to ${res.approverLabel} for approval`
          : 'Allowance added',
      })
      setDescription('')
      setHours(undefined)
      setAmount(0)
      onSuccess()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to add allowance',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate()
      }}
      className="space-y-3 border-t border-border pt-4"
    >
      <p className="text-sm font-medium">Add Allowance</p>
      <div className="space-y-2">
        <Label>Type</Label>
        <Select value={type} onValueChange={(v) => setType(v as AllowanceType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALLOWANCE_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>
          What is it for? <span className="text-destructive">*</span> (printed on the payslip)
        </Label>
        <Input
          value={description}
          placeholder="e.g. Extra duty in place of Dr. Atika"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Hours</Label>
        <Input
          type="number"
          min={0}
          step="0.01"
          value={hours ?? ''}
          onChange={(e) =>
            setHours(e.target.value ? Number(e.target.value) : undefined)
          }
        />
      </div>
      {hasHours ? (
        <p className="text-sm">
          Amount:{' '}
          <strong>
            {calculatedAmount != null
              ? formatPKR(calculatedAmount)
              : 'calculated automatically'}
          </strong>
        </p>
      ) : (
        <div className="space-y-2">
          <Label>Amount</Label>
          <PKRInput value={amount} onChange={setAmount} />
        </div>
      )}
      {needsApproval ? <ApproverSelect value={approver} onChange={setApprover} /> : null}
      <Button
        type="submit"
        disabled={
          mutation.isPending ||
          !canSubmit ||
          description.trim().length < 3 ||
          (needsApproval && !approver)
        }
        size="sm"
      >
        {mutation.isPending ? 'Adding...' : needsApproval ? 'Send for approval' : 'Add Allowance'}
      </Button>
    </form>
  )
}

function PayrollDetailDialog({
  entry,
  open,
  onOpenChange,
  onRefresh,
}: {
  entry: PayrollEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRefresh: (entry: PayrollEntry) => void
}) {
  const queryClient = useQueryClient()
  const [detailTab, setDetailTab] = useState('deductions')
  const canManagePayroll = useCanEditPay()

  const { data: fullEntry, refetch } = useQuery({
    queryKey: ['payroll-entry-full', entry?.id],
    queryFn: () => payrollApi.getEntryFull(entry!.id),
    enabled: !!entry && open,
  })

  const employeeId = fullEntry?.stipendRecord?.employee?.id

  const { data: relieverData } = useQuery({
    queryKey: ['reliever-sessions', employeeId, fullEntry?.month, fullEntry?.year],
    queryFn: () =>
      attendanceApi.getRelieverSessions(employeeId!, {
        month: fullEntry!.month,
        year: fullEntry!.year,
      }),
    enabled: !!employeeId && !!fullEntry && open && detailTab === 'allowances',
  })

  if (!entry) return null

  const data = fullEntry ?? entry
  const deductions = data.deductions ?? []
  const allowances = data.allowances ?? []
  const totalDeductions = deductions.reduce(
    (sum, d) => sum + Number(d.amount),
    0,
  )
  const totalAllowances = allowances.reduce(
    (sum, a) => sum + Number(a.amount),
    0,
  )

  const relieverHours = data.totalRelieverHours ?? relieverData?.totalHours ?? 0
  const relieverMins = relieverData?.totalMinutes ?? Math.round(relieverHours * 60)
  const relieverH = Math.floor(relieverMins / 60)
  const relieverM = relieverMins % 60

  const slip = data.slip ?? buildPayslipSlipFromEntry(data)

  const refresh = async () => {
    queryClient.invalidateQueries({ queryKey: ['payroll-entries'] })
    const updated = await refetch()
    if (updated.data) onRefresh(updated.data)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90dvh,90vh)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="no-print">
          <DialogTitle>Payroll Detail</DialogTitle>
        </DialogHeader>

        <div className={detailTab === 'payslip' ? 'hidden' : undefined}>
        {data.attendance && (
          <div className="mb-4 grid grid-cols-3 gap-2 rounded-lg border border-border bg-surface p-3 text-sm no-print sm:grid-cols-8">
            {[
              ['Present', data.attendance.present],
              ['Absent', data.attendance.absent],
              ['On leave', data.attendance.onLeave],
              ['Late', data.attendance.late],
              ['Early out', data.attendance.earlyCheckout ?? 0],
              ['Missed checkout', data.attendance.missingCheckout ?? 0],
              ['Overtime', `${data.attendance.overtimeHours} hrs`],
              ['Extra days', data.attendance.extraWorkingDays],
            ].map(([label, value]) => (
              <div key={label} className="text-center">
                <p className="text-lg font-semibold tabular-nums">{value}</p>
                <p className="text-xs text-text-secondary">{label}</p>
              </div>
            ))}
          </div>
        )}

        {data.hourlyBreakdown && (
          <div className="mb-4 space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm no-print">
            <p className="font-semibold">Basic stipend (attendance days)</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span className="text-text-secondary">Contractual monthly basic</span>
              <span className="text-right">
                {formatPKR(data.hourlyBreakdown.contractualBasicStipend)}
              </span>
              <span className="text-text-secondary">Credited days</span>
              <span className="text-right font-medium">
                {data.hourlyBreakdown.creditedAttendanceDays ??
                  Math.round(
                    (data.hourlyBreakdown.payableHours /
                      (data.hourlyBreakdown.dailyDutyHours || 8)) *
                      100,
                  ) / 100}
                {' / '}
                {data.hourlyBreakdown.daysInMonth}
              </span>
              <span className="text-text-secondary">Daily basic</span>
              <span className="text-right">
                {formatPKR(
                  data.hourlyBreakdown.daysInMonth
                    ? data.hourlyBreakdown.contractualBasicStipend /
                        data.hourlyBreakdown.daysInMonth
                    : 0,
                )}
              </span>
              <span className="text-text-secondary">Basic stipend</span>
              <span className="text-right font-medium text-primary">
                {formatPKR(
                  data.hourlyBreakdown.payrollBasicStipend ??
                    data.hourlyBreakdown.hourlyBasicEarned,
                )}
              </span>
              <span className="text-text-secondary">Hourly rate (OT only)</span>
              <span className="text-right">
                {formatPKR(data.hourlyBreakdown.hourlyRate)}/hr
              </span>
              <span className="text-text-secondary">Fixed allowances</span>
              <span className="text-right">
                {formatPKR(data.hourlyBreakdown.fixedAllowances)}
              </span>
              <span className="text-text-secondary">Extra allowances (OT etc.)</span>
              <span className="text-right">
                {formatPKR(data.hourlyBreakdown.extraAllowances)}
              </span>
              <span className="text-text-secondary">Fixed package deductions</span>
              <span className="text-right text-red-600">
                {formatPKR(data.hourlyBreakdown.fixedPackageDeductions)}
              </span>
              <span className="text-text-secondary">
                Discipline deductions (3/6/9 late, uninformed)
              </span>
              <span className="text-right text-red-600">
                {formatPKR(data.hourlyBreakdown.disciplineDeductions)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
              <span>Net stipend</span>
              <span className="text-primary">
                {formatPKR(data.hourlyBreakdown.netStipend)}
              </span>
            </div>
          </div>
        )}

        {data.stipendRecord && (
          <div className="mb-4 space-y-3 rounded-lg border border-border bg-surface p-4 text-sm no-print">
            <p className="font-semibold">Stipend Package</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span className="text-text-secondary">Basic Stipend</span>
              <span className="text-right">{formatPKR(data.stipendRecord.basicStipend)}</span>
              <span className="text-text-secondary">Allowances</span>
              <span className="text-right">{formatPKR(data.stipendRecord.allowances ?? 0)}</span>
              <span className="text-text-secondary">Reward</span>
              <span className="text-right">{formatPKR(data.stipendRecord.reward ?? 0)}</span>
              <span className="text-text-secondary">Reward on Progress</span>
              <span className="text-right">{formatPKR(data.stipendRecord.progressReward ?? 0)}</span>
              <span className="text-text-secondary">Petrol (Fuel)</span>
              <span className="text-right">{formatPKR(data.stipendRecord.fuelAllowance ?? 0)}</span>
            </div>
            <div className="border-t border-border pt-2">
              <p className="mb-1 font-medium text-text-secondary">Fixed Deductions</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="text-text-secondary">Loan</span>
                <span className="text-right text-red-600">
                  {formatPKR(data.stipendRecord.loanDeduction ?? 0)}
                </span>
                <span className="text-text-secondary">Advance</span>
                <span className="text-right text-red-600">
                  {formatPKR(data.stipendRecord.advanceDeduction ?? 0)}
                </span>
                <span className="text-text-secondary">Fine</span>
                <span className="text-right text-red-600">
                  {formatPKR(data.stipendRecord.fineDeduction ?? 0)}
                </span>
                <span className="text-text-secondary">Health</span>
                <span className="text-right text-red-600">
                  {formatPKR(data.stipendRecord.healthDeduction ?? 0)}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
              <span>Package reference (full month)</span>
              <span className="text-primary">
                {formatPKR(
                  data.stipendRecord.lumpsumTotal ??
                    calculateLumpsumTotal({
                      basicStipend: Number(data.stipendRecord.basicStipend) || 0,
                      allowances: Number(data.stipendRecord.allowances) || 0,
                      reward: Number(data.stipendRecord.reward) || 0,
                      progressReward: Number(data.stipendRecord.progressReward) || 0,
                      fuelAllowance: Number(data.stipendRecord.fuelAllowance) || 0,
                      loanDeduction: Number(data.stipendRecord.loanDeduction) || 0,
                      advanceDeduction: Number(data.stipendRecord.advanceDeduction) || 0,
                      fineDeduction: Number(data.stipendRecord.fineDeduction) || 0,
                      healthDeduction: Number(data.stipendRecord.healthDeduction) || 0,
                    }),
                )}
              </span>
            </div>
          </div>
        )}

        </div>

        <Tabs value={detailTab} onValueChange={setDetailTab}>
          <TabsList className="no-print flex h-auto w-full flex-wrap justify-start gap-1 sm:inline-flex sm:h-10 sm:flex-nowrap">
            <TabsTrigger value="deductions" className="flex-1 sm:flex-none">
              Deductions
            </TabsTrigger>
            <TabsTrigger value="allowances" className="flex-1 sm:flex-none">
              Allowances
            </TabsTrigger>
            <TabsTrigger value="payslip" className="flex-1 sm:flex-none">
              Payslip
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1 sm:flex-none">
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="deductions" className="no-print space-y-4">
            <DeductionsTable
              deductions={deductions}
              editable={entry.status === 'PENDING' && canManagePayroll}
              onChanged={refresh}
            />
            <p className="text-right font-semibold">
              Total Deductions: {formatPKR(totalDeductions)}
            </p>
            {entry.status === 'PENDING' && canManagePayroll && (
              <AddDeductionForm payrollEntryId={entry.id} onSuccess={refresh} />
            )}
          </TabsContent>

          <TabsContent value="allowances" className="no-print space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allowances.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-text-secondary">
                      No allowances
                    </TableCell>
                  </TableRow>
                ) : (
                  allowances.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.type.replace(/_/g, ' ')}</TableCell>
                      <TableCell>{a.description ?? '—'}</TableCell>
                      <TableCell>{a.hours ?? '—'}</TableCell>
                      <TableCell className="text-green-600">
                        {formatPKR(a.amount)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <p className="text-right font-semibold">
              Total Allowances: {formatPKR(totalAllowances)}
            </p>
            <p className="rounded-lg border border-border bg-surface p-3 text-sm">
              Reliever hours this month:{' '}
              <strong>
                {relieverH} hrs {relieverM} mins
              </strong>
            </p>
            {entry.status === 'PENDING' && canManagePayroll && (
              <AddAllowanceForm
                payrollEntryId={entry.id}
                hourlyRate={data.hourlyBreakdown?.hourlyRate}
                onSuccess={refresh}
              />
            )}
          </TabsContent>

          <TabsContent value="payslip" className="space-y-4">
            <div className="no-print flex justify-end">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Button>
            </div>
            <PayslipDocument slip={slip} />
          </TabsContent>

          <TabsContent value="history" className="no-print space-y-2">
            <PayrollChangeHistory entryId={entry.id} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

/** Employee profiles, attendance tab cards, and portal My Payroll read the same PayrollEntry rows. */
function RowDeductionsEditor({
  entry,
  onAdded,
}: {
  entry: PayrollEntry
  onAdded: () => void
}) {
  const queryClient = useQueryClient()
  const { data: fullEntry, refetch } = useQuery({
    queryKey: ['payroll-entry-full', entry.id],
    queryFn: () => payrollApi.getEntryFull(entry.id),
  })
  const deductions = (fullEntry ?? entry).deductions ?? []

  return (
    <div className="space-y-4">
      <DeductionsTable
        deductions={deductions}
        editable={entry.status === 'PENDING'}
        onChanged={() => {
          void refetch()
          invalidatePayrollViews(queryClient)
        }}
      />
      <AddDeductionForm payrollEntryId={entry.id} onSuccess={onAdded} />
    </div>
  )
}

function invalidatePayrollViews(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['payroll-entries'] })
  queryClient.invalidateQueries({ queryKey: ['payroll-summary'] })
  queryClient.invalidateQueries({ queryKey: ['payroll-history'] })
  queryClient.invalidateQueries({ queryKey: ['stipend-receipts'] })
}

function MonthlyPayrollTab() {
  const queryClient = useQueryClient()
  const now = new Date()

  const [monthYear, setMonthYear] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })
  const [branchId, setBranchId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [designationFilter, setDesignationFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [empStatusFilter, setEmpStatusFilter] = useState(ALL)
  const [selectedPrintIds, setSelectedPrintIds] = useState<Set<string>>(new Set())
  const [nameSearch, setNameSearch] = useState('')
  const [viewEntry, setViewEntry] = useState<PayrollEntry | null>(null)
  const [allowancesFor, setAllowancesFor] = useState<{ id: string; name: string } | null>(null)
  const canFinalize = useCanFinalizePayroll()
  const canFinanceEdit = useCanEditPay()
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [addDeductionEntry, setAddDeductionEntry] = useState<PayrollEntry | null>(
    null,
  )
  const [incentiveEmployeeId, setIncentiveEmployeeId] = useState<string | null>(
    null,
  )
  const canAddIncentive = useCanEditPay()
  const [confirmGenerate, setConfirmGenerate] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetAllUnpaidMonths, setResetAllUnpaidMonths] = useState(false)
  const [createSingleOpen, setCreateSingleOpen] = useState(false)
  const [selectedEmployees, setSelectedEmployees] = useState<Employee[]>([])
  const [approvalReason, setApprovalReason] = useState('')
  const [confirmStatus, setConfirmStatus] = useState<{
    id: string
    status: PayrollStatus
  } | null>(null)

  const filters = useMemo(
    () => ({
      month: monthYear.month,
      year: monthYear.year,
      branchId: branchId || undefined,
      departmentId: departmentId || undefined,
      designation: designationFilter || undefined,
      status: statusFilter !== ALL ? statusFilter : undefined,
    }),
    [monthYear, branchId, departmentId, designationFilter, statusFilter],
  )

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', branchId || 'all'],
    queryFn: () =>
      departmentsApi.getAll(branchId ? { branchId } : undefined),
  })

  const { data: designations = [] } = useQuery({
    queryKey: ['designations'],
    queryFn: () => designationsApi.getAll(),
  })

  const designationOptions = useMemo(() => {
    const seen = new Set<string>()
    const titles: string[] = []
    for (const d of designations) {
      if (d.isActive === false) continue
      const title = d.title?.trim()
      if (!title) continue
      const key = title.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      titles.push(title)
    }
    return titles.sort((a, b) => a.localeCompare(b))
  }, [designations])

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['payroll-entries', filters],
    queryFn: () => payrollApi.getEntries(filters),
  })

  const filteredEntries = useMemo(() => {
    const q = nameSearch.trim().toLowerCase()
    return entries.filter((e) => {
      const emp = e.stipendRecord?.employee
      // No salary without at least one working day (Present/Late/Short
      // Leave/Half Day) — e.g. staff on rest for months. Same rule as the API.
      const worked =
        e.attendance?.worked ??
        (e.attendance?.present ?? 0) + (e.attendance?.late ?? 0) > 0
      if (!worked) return false
      // employee status filter
      if (empStatusFilter !== ALL && emp?.status !== empStatusFilter) return false
      // name/code search
      if (q) {
        return (
          emp?.fullName?.toLowerCase().includes(q) ||
          emp?.employeeCode?.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [entries, nameSearch, empStatusFilter])

  const { page, setPage, totalPages, paginated, total } = usePagination(
    filteredEntries,
    [filters, nameSearch],
  )

  const [printSlips, setPrintSlips] = useState<PayslipSlipData[] | null>(null)
  const clearPrintSlips = useCallback(() => setPrintSlips(null), [])
  const payslipsMutation = useMutation({
    mutationFn: () => {
      const toPrint = selectedPrintIds.size > 0
        ? filteredEntries.filter((e) => selectedPrintIds.has(e.id))
        : filteredEntries
      return payrollApi.getPayslips(toPrint.map((e) => e.id))
    },
    onSuccess: (rows) => {
      const byId = new Map(rows.map((row) => [row.entryId, row.slip]))
      const toPrint = selectedPrintIds.size > 0
        ? filteredEntries.filter((e) => selectedPrintIds.has(e.id))
        : filteredEntries
      // Keep the on-screen order of the filtered list.
      setPrintSlips(
        toPrint
          .map((e) => byId.get(e.id))
          .filter((slip): slip is PayslipSlipData => !!slip),
      )
    },
    onError: (err) =>
      toast({
        title: 'Could not load payslips',
        description: getApiErrorMessage(err, 'Please try again'),
        variant: 'destructive',
      }),
  })

  const { data: monthIncentives = [] } = useQuery({
    queryKey: ['incentives', monthYear.year, monthYear.month],
    queryFn: () =>
      incentivesApi.getAll({ year: monthYear.year, month: monthYear.month }),
  })

  const incentiveTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const inc of monthIncentives) {
      totals.set(
        inc.employeeId,
        (totals.get(inc.employeeId) ?? 0) + Number(inc.amount),
      )
    }
    return totals
  }, [monthIncentives])

  const generateMutation = useMutation({
    mutationFn: () =>
      payrollApi.rebuildMonthBatch({
        month: monthYear.month,
        year: monthYear.year,
        branchId: branchId || undefined,
      }),
    onSuccess: ({ generated, skipped, failed, total, failureNotes }) => {
      toast({
        title: `Generated ${generated} of ${total} payroll entries`,
        description: [
          'Calculated from attendance, stipend allowances, and issued fine letters.',
          'Employee profiles and portal My Payroll will show these figures.',
          skipped > 0 ? `Skipped (no stipend): ${skipped}` : null,
          failed > 0
            ? `Failed: ${failed}${failureNotes[0] ? ` (${failureNotes[0]})` : ''}`
            : null,
        ]
          .filter(Boolean)
          .join(' '),
        variant: failed > 0 ? 'destructive' : 'default',
      })
      invalidatePayrollViews(queryClient)
      setConfirmGenerate(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to generate entries',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const resetMutation = useMutation({
    mutationFn: () =>
      payrollApi.resetUnpaid({
        month: monthYear.month,
        year: monthYear.year,
        branchId: branchId || undefined,
        allUnpaidMonths: resetAllUnpaidMonths || undefined,
        confirm: 'RESET_UNPAID_PAYROLL',
      }),
    onSuccess: (result) => {
      toast({
        title: `Cleared ${result.deleted} unpaid payroll ${result.deleted === 1 ? 'entry' : 'entries'}`,
        description: [
          result.paidSkipped > 0
            ? `${result.paidSkipped} PAID ${result.paidSkipped === 1 ? 'entry was' : 'entries were'} left unchanged.`
            : null,
          result.allUnpaidMonths
            ? 'All unpaid months were cleared.'
            : 'Employee profiles and portal payroll history will no longer show these rows.',
        ]
          .filter(Boolean)
          .join(' '),
      })
      invalidatePayrollViews(queryClient)
      setConfirmReset(false)
      setResetAllUnpaidMonths(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to clear payroll',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const isNonActiveForPayroll = (status?: string | null) =>
    !!status && status !== 'ACTIVE' && status !== 'ON_REST'

  const needsForceApproval = selectedEmployees.some((e) =>
    isNonActiveForPayroll(e.status),
  )

  const resetCreateSingle = () => {
    setSelectedEmployees([])
    setApprovalReason('')
  }

  const createSingleMutation = useMutation({
    mutationFn: async () => {
      if (selectedEmployees.length === 0) throw new Error('Select an employee')
      // Sequential, one audited single-entry call per employee, so one
      // employee's failure does not block the rest.
      const created: Employee[] = []
      const failed: Array<{ employee: Employee; message: string }> = []
      for (const emp of selectedEmployees) {
        try {
          await payrollApi.createEntry({
            employeeId: emp.id,
            month: monthYear.month,
            year: monthYear.year,
            ...(isNonActiveForPayroll(emp.status)
              ? {
                  allowNonActive: true,
                  approvalReason: approvalReason.trim(),
                }
              : {}),
          })
          created.push(emp)
        } catch (err) {
          failed.push({ employee: emp, message: getApiErrorMessage(err, 'Error') })
        }
      }
      return { created, failed }
    },
    onSuccess: ({ created, failed }) => {
      if (created.length > 0) invalidatePayrollViews(queryClient)
      if (failed.length === 0) {
        toast({
          title: `Created ${created.length} payroll ${created.length === 1 ? 'entry' : 'entries'}`,
        })
        setCreateSingleOpen(false)
        resetCreateSingle()
        return
      }
      toast({
        title: `Created ${created.length}, failed ${failed.length}`,
        description: failed
          .map((f) => `${f.employee.employeeCode} ${f.employee.fullName}: ${f.message}`)
          .join(' | '),
        variant: 'destructive',
      })
      // Keep only the failed employees selected so they can be fixed and retried.
      setSelectedEmployees(failed.map((f) => f.employee))
    },
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PayrollStatus }) =>
      payrollApi.updateStatus(id, { status }),
    onSuccess: () => {
      toast({ title: 'Payroll status updated' })
      invalidatePayrollViews(queryClient)
      setConfirmStatus(null)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to update status',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const printSubtitle = useMemo(() => {
    const branchLabel = branchId
      ? formatBranchLabel(
          branches.find((b) => b.id === branchId) ?? { name: branchId },
        )
      : 'All Branches'
    const departmentLabel = departmentId
      ? (departments.find((d) => d.id === departmentId)?.name ?? 'Department')
      : 'All Departments'
    return [
      format(new Date(monthYear.year, monthYear.month - 1), 'MMMM yyyy'),
      branchLabel,
      departmentLabel,
      designationFilter || 'All Designations',
      statusFilter !== ALL ? statusFilter : 'All Statuses',
    ].join(' · ')
  }, [
    monthYear,
    branchId,
    branches,
    departmentId,
    departments,
    designationFilter,
    statusFilter,
  ])

  const monthlyReportRows = useMemo(
    () => buildMonthlyPayrollReportRows(filteredEntries),
    [filteredEntries],
  )

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <MonthYearPicker value={monthYear} onChange={setMonthYear} />

          <div className="space-y-1">
            <Label>Branch</Label>
            <Select
              value={branchId || 'all'}
              onValueChange={(v) => {
                setBranchId(v === 'all' ? '' : v)
                setDepartmentId('')
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {formatBranchLabel(b)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="PROCESSED">Processed</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Emp. Status</Label>
            <Select value={empStatusFilter} onValueChange={(v) => { setEmpStatusFilter(v); setPage(0) }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {EMPLOYEE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {employeeStatusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Department</Label>
            <Select
              value={departmentId || 'all'}
              onValueChange={(v) => setDepartmentId(v === 'all' ? '' : v)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Designation</Label>
            <Select
              value={designationFilter || 'all'}
              onValueChange={(v) => setDesignationFilter(v === 'all' ? '' : v)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Designations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Designations</SelectItem>
                {designationOptions.map((title) => (
                  <SelectItem key={title} value={title}>
                    {title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Search by name / code</Label>
            <Input
              placeholder="Search employee…"
              value={nameSearch}
              onChange={(e) => { setNameSearch(e.target.value); setPage(0) }}
              className="w-[200px]"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            onClick={() => setConfirmReset(true)}
          >
            Clear unpaid payroll
          </Button>
          <Button variant="outline" onClick={() => setCreateSingleOpen(true)}>
            Add entry for employee
          </Button>
          <PrintPayrollReportButton disabled={entries.length === 0} />
          {canFinalize ? (
            <Button variant="outline" onClick={() => setFinalizeOpen(true)}>
              Finalise branch
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={filteredEntries.length === 0}
            onClick={() =>
              exportMonthlyPayrollCsv(
                monthlyReportRows,
                `payroll-${monthYear.year}-${String(monthYear.month).padStart(2, '0')}`,
              )
            }
          >
            Export Excel
          </Button>
          <Button
            variant="outline"
            disabled={filteredEntries.length === 0 || payslipsMutation.isPending}
            onClick={() => payslipsMutation.mutate()}
            title={selectedPrintIds.size > 0 ? `Print ${selectedPrintIds.size} selected payslips` : 'Print payslips of all visible employees (2 per A4 page)'}
          >
            <Printer className="mr-2 h-4 w-4" />
            {payslipsMutation.isPending
              ? `Preparing payslips...`
              : selectedPrintIds.size > 0
              ? `Print ${selectedPrintIds.size} Selected (2 per page)`
              : 'Print Payslips (2 per page)'}
          </Button>
          {printSlips && printSlips.length > 0 && (
            <PayslipPrintSheet slips={printSlips} onDone={clearPrintSlips} />
          )}
          <Button
            className="bg-primary hover:bg-primary-dark"
            onClick={() => setConfirmGenerate(true)}
          >
            Generate Entries
          </Button>
        </div>
      </div>

      <div className="no-print">
      <TableRecordCount count={total} label="payroll entry" />

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <input
                  type="checkbox"
                  title="Select all for printing"
                  checked={paginated.length > 0 && paginated.every((e) => selectedPrintIds.has(e.id))}
                  onChange={(ev) => {
                    if (ev.target.checked) {
                      setSelectedPrintIds((prev) => {
                        const next = new Set(prev)
                        for (const e of paginated) next.add(e.id)
                        return next
                      })
                    } else {
                      setSelectedPrintIds((prev) => {
                        const next = new Set(prev)
                        for (const e of paginated) next.delete(e.id)
                        return next
                      })
                    }
                  }}
                  className="cursor-pointer"
                />
              </TableHead>
              <TableHead>Employee</TableHead>
              <TableHead className="whitespace-nowrap">Employee Status</TableHead>
              <TableHead className="whitespace-nowrap text-right" title="Present + swap covered">
                Present
              </TableHead>
              <TableHead className="whitespace-nowrap text-right" title="Absent + uninformed absent">
                Absent
              </TableHead>
              <TableHead className="whitespace-nowrap text-right">On leave</TableHead>
              <TableHead className="whitespace-nowrap text-right">Late</TableHead>
              <TableHead
                className="whitespace-nowrap text-right"
                title="Days checked out before duty end (beyond 15 min grace)"
              >
                Early out
              </TableHead>
              <TableHead
                className="whitespace-nowrap text-right"
                title="Days without a checkout (closed automatically at duty end)"
              >
                Missed checkout
              </TableHead>
              <TableHead className="whitespace-nowrap text-right">OT hrs</TableHead>
              <TableHead className="whitespace-nowrap text-right">Extra days</TableHead>
              <TableHead title="Contractual basic stipend before any deductions or proration">Actual Stipend</TableHead>
              <TableHead title="Earned stipend after proration for joining date / days worked">Earned Stipend</TableHead>
              <TableHead>Deductions</TableHead>
              <TableHead>Allowances</TableHead>
              <TableHead>Net Stipend</TableHead>
              <TableHead className="whitespace-nowrap">Incentive</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(16)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={16} className="h-32 text-center text-text-secondary">
                  No payroll entries for this period
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((entry) => {
                const emp = entry.stipendRecord?.employee
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="w-[40px]">
                      <input
                        type="checkbox"
                        checked={selectedPrintIds.has(entry.id)}
                        onChange={(ev) => {
                          setSelectedPrintIds((prev) => {
                            const next = new Set(prev)
                            if (ev.target.checked) next.add(entry.id)
                            else next.delete(entry.id)
                            return next
                          })
                        }}
                        className="cursor-pointer"
                      />
                    </TableCell>
                    <TableCell>
                      <div>
                        <EmployeeNameLink employee={emp} />
                        <p className="font-mono text-xs text-text-secondary">
                          {emp?.employeeCode ?? '—'}
                        </p>
                        {entry.forcedNonActive ? (
                          <Badge
                            variant="outline"
                            className="mt-1 border-amber-200 bg-amber-50 text-amber-800"
                          >
                            Approved exception
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {emp?.status ? <StatusBadge status={emp.status} /> : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.attendance?.present ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.attendance?.absent ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.attendance?.onLeave ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.attendance?.late ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.attendance?.earlyCheckout ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.attendance?.missingCheckout ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.attendance?.overtimeHours ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.attendance?.extraWorkingDays ?? 0}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatPKR(entry.stipendRecord?.basicStipend ?? entry.hourlyBreakdown?.contractualBasicStipend ?? entry.basicStipend)}
                    </TableCell>
                    <TableCell>{formatPKR(entry.basicStipend)}</TableCell>
                    <TableCell
                      className={cn(
                        Number(entry.totalDeductions) > 0 && 'text-red-600',
                      )}
                    >
                      {formatPKR(Math.max(0, Number(entry.totalDeductions)))}
                    </TableCell>
                    <TableCell>{formatPKR(entry.totalAllowances)}</TableCell>
                    <TableCell className="font-medium">
                      {formatPKR(entry.netStipend)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span
                          className={cn(
                            emp?.id && incentiveTotals.get(emp.id)
                              ? 'text-green-700'
                              : 'text-text-secondary',
                          )}
                        >
                          {formatPKR(emp?.id ? incentiveTotals.get(emp.id) ?? 0 : 0)}
                        </span>
                        {canAddIncentive && entry.status === 'PENDING' && emp?.id && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            title="Add incentive"
                            onClick={() => setIncentiveEmployeeId(emp.id)}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <PayrollStatusBadge status={entry.status} />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setViewEntry(entry)}
                          >
                            Payroll Detail
                          </DropdownMenuItem>
                          {entry.status === 'PENDING' && (
                            <>
                              {canFinalize ? (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setConfirmStatus({
                                      id: entry.id,
                                      status: 'PROCESSED',
                                    })
                                  }
                                >
                                  Mark as Processed
                                </DropdownMenuItem>
                              ) : null}
                              {canFinanceEdit ? (
                                <DropdownMenuItem
                                  onClick={() => setAddDeductionEntry(entry)}
                                >
                                  Add Deduction
                                </DropdownMenuItem>
                              ) : null}
                            </>
                          )}
                          {entry.stipendRecord?.employee?.id ? (
                            <DropdownMenuItem
                              onClick={() =>
                                setAllowancesFor({
                                  id: entry.stipendRecord!.employee!.id,
                                  name: entry.stipendRecord!.employee!.fullName,
                                })
                              }
                            >
                              Allowances
                            </DropdownMenuItem>
                          ) : null}
                          {entry.status === 'PROCESSED' && canFinalize && (
                            <DropdownMenuItem
                              onClick={() =>
                                setConfirmStatus({
                                  id: entry.id,
                                  status: 'PAID',
                                })
                              }
                            >
                              Mark as Paid
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        page={page}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
      />
      </div>

      <PayrollReportPrintSection
        id="monthly-payroll-print"
        title="Monthly Payroll Report"
        subtitle={printSubtitle}
        rows={monthlyReportRows}
        variant="monthly"
        footer={`Total entries: ${entries.length}. Attendance is the full month (same counts on every stipend row for that employee).`}
      />

      <AddIncentiveDialog
        open={!!incentiveEmployeeId}
        onOpenChange={(v) => !v && setIncentiveEmployeeId(null)}
        defaultEmployeeId={incentiveEmployeeId ?? undefined}
        defaultMonth={monthYear.month}
        defaultYear={monthYear.year}
        onSuccess={() => invalidatePayrollViews(queryClient)}
      />

      <PayrollDetailDialog
        entry={viewEntry}
        open={!!viewEntry}
        onOpenChange={(v) => !v && setViewEntry(null)}
        onRefresh={setViewEntry}
      />

      {addDeductionEntry && (
        <Dialog
          open={!!addDeductionEntry}
          onOpenChange={(v) => !v && setAddDeductionEntry(null)}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Deductions</DialogTitle>
            </DialogHeader>
            <RowDeductionsEditor
              entry={addDeductionEntry}
              onAdded={() => {
                invalidatePayrollViews(queryClient)
                setAddDeductionEntry(null)
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {finalizeOpen ? (
        <PayrollFinalizeDialog
          month={monthYear.month}
          year={monthYear.year}
          defaultBranchId={branchId || undefined}
          onClose={() => setFinalizeOpen(false)}
        />
      ) : null}

      {allowancesFor ? (
        <Dialog open onOpenChange={(open) => !open && setAllowancesFor(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Allowances — {allowancesFor.name}</DialogTitle>
            </DialogHeader>
            <EmployeeAllowancesPanel employeeId={allowancesFor.id} />
          </DialogContent>
        </Dialog>
      ) : null}

      <ConfirmDialog
        open={confirmGenerate}
        title="Generate Payroll Entries"
        description={`Calculate payroll for all ACTIVE and ON REST employees for ${format(new Date(monthYear.year, monthYear.month - 1), 'MMMM yyyy')} from attendance (present, absent, half day, unmarked), stipend package allowances/deductions, reliever/additional-day pay, and issued fine letters. The same figures appear on employee profiles and in the employee portal.`}
        confirmLabel="Generate"
        loading={generateMutation.isPending}
        onConfirm={() => generateMutation.mutate()}
        onCancel={() => setConfirmGenerate(false)}
      />

      <Dialog
        open={confirmReset}
        onOpenChange={(open) => {
          setConfirmReset(open)
          if (!open) setResetAllUnpaidMonths(false)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clear unpaid payroll</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-text-secondary">
            <p>
              This removes PENDING and PROCESSED payroll for{' '}
              {resetAllUnpaidMonths
                ? 'every unpaid month'
                : format(new Date(monthYear.year, monthYear.month - 1), 'MMMM yyyy')}
              {branchId ? ' in the selected branch' : ''} from the HR payroll
              list, employee profile payroll tabs, attendance salary cards,
              and the employee portal. Incentives added for those months are
              deleted too. PAID entries are never removed.
            </p>
            <p>
              After clearing, click Generate Entries to rebuild from current
              attendance and issued fine letters.
            </p>
            <label className="flex items-start gap-2 text-text-primary">
              <input
                type="checkbox"
                className="mt-1"
                checked={resetAllUnpaidMonths}
                onChange={(e) => setResetAllUnpaidMonths(e.target.checked)}
              />
              <span>Clear unpaid payroll in all months, not only this month</span>
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmReset(false)
                setResetAllUnpaidMonths(false)
              }}
              disabled={resetMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending ? 'Clearing…' : 'Clear unpaid payroll'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createSingleOpen}
        onOpenChange={(open) => {
          setCreateSingleOpen(open)
          if (!open) resetCreateSingle()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add payroll entries</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-text-secondary">
              Month: {format(new Date(monthYear.year, monthYear.month - 1), 'MMMM yyyy')}
              . Default eligibility is ACTIVE / ON REST. Resigned, terminated,
              suspended (or other) employees require an approval reason from
              higher authorities. You can add several employees at once.
            </p>
            <EmployeeSearchSelect
              label="Add employee"
              value=""
              excludeIds={selectedEmployees.map((e) => e.id)}
              onChange={(id, emp) => {
                if (!id || !emp) return
                setSelectedEmployees((prev) =>
                  prev.some((e) => e.id === id) ? prev : [...prev, emp],
                )
              }}
            />
            {selectedEmployees.length > 0 ? (
              <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-border p-2">
                {selectedEmployees.map((emp) => (
                  <div
                    key={emp.id}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                  >
                    <div className="min-w-0">
                      <p className="truncate">
                        <span className="font-mono text-xs text-text-secondary">
                          {emp.employeeCode}
                        </span>{' '}
                        — {emp.fullName}
                      </p>
                      {isNonActiveForPayroll(emp.status) ? (
                        <p className="text-xs text-amber-700">
                          {emp.status}
                          {emp.statusEffectiveFrom
                            ? ` · effective from ${format(new Date(emp.statusEffectiveFrom), 'dd MMM yyyy')}`
                            : ' · no effective-from date set, check before paying'}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 p-0"
                      aria-label={`Remove ${emp.fullName}`}
                      onClick={() =>
                        setSelectedEmployees((prev) =>
                          prev.filter((e) => e.id !== emp.id),
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            {needsForceApproval ? (
              <div className="space-y-2">
                <Label>Approval reason (required)</Label>
                <Textarea
                  value={approvalReason}
                  onChange={(e) => setApprovalReason(e.target.value)}
                  placeholder="e.g. Approved by Chairman to pay suspended employee for this month"
                  rows={3}
                />
                <p className="text-xs text-amber-700">
                  Non-active employees selected. This reason applies to all of
                  them; each gets a forced payroll entry and an audit log.
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateSingleOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={
                selectedEmployees.length === 0 ||
                createSingleMutation.isPending ||
                (needsForceApproval && !approvalReason.trim())
              }
              onClick={() => createSingleMutation.mutate()}
            >
              {createSingleMutation.isPending
                ? 'Creating…'
                : selectedEmployees.length > 1
                  ? `Create ${selectedEmployees.length} entries`
                  : 'Create entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmStatus}
        title="Update Payroll Status"
        description={`Mark this entry as ${confirmStatus?.status}?`}
        confirmLabel="Confirm"
        loading={statusMutation.isPending}
        onConfirm={() =>
          confirmStatus &&
          statusMutation.mutate({
            id: confirmStatus.id,
            status: confirmStatus.status,
          })
        }
        onCancel={() => setConfirmStatus(null)}
      />
    </div>
  )
}

const stipendFieldSchema = z.number().min(0)

function firstOfMonthIso(isoDate: string): string {
  if (!isoDate || isoDate.length < 7) return isoDate
  return `${isoDate.slice(0, 7)}-01`
}

function firstOfCurrentMonthIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

const incrementSchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  basicStipend: z.number().positive('Stipend must be greater than 0'),
  allowances: stipendFieldSchema,
  reward: stipendFieldSchema,
  progressReward: stipendFieldSchema,
  fuelAllowance: stipendFieldSchema,
  loanDeduction: stipendFieldSchema,
  advanceDeduction: stipendFieldSchema,
  fineDeduction: stipendFieldSchema,
  healthDeduction: stipendFieldSchema,
  effectiveFrom: z.string().min(1, 'Effective date is required'),
  reason: z.string().min(1, 'Reason is required'),
})

type IncrementFormValues = z.infer<typeof incrementSchema>

function StipendIncrementTab() {
  const [currentLumpsum, setCurrentLumpsum] = useState<number | null>(null)

  const form = useForm<IncrementFormValues>({
    resolver: zodResolver(incrementSchema),
    defaultValues: {
      employeeId: '',
      ...DEFAULT_STIPEND_VALUES,
      effectiveFrom: firstOfCurrentMonthIso(),
      reason: '',
    },
  })

  const watched = form.watch([
    'basicStipend',
    'allowances',
    'reward',
    'progressReward',
    'fuelAllowance',
    'loanDeduction',
    'advanceDeduction',
    'fineDeduction',
    'healthDeduction',
  ])

  const newLumpsum = useMemo(
    () =>
      calculateLumpsumTotal({
        basicStipend: Number(watched[0]) || 0,
        allowances: Number(watched[1]) || 0,
        reward: Number(watched[2]) || 0,
        progressReward: Number(watched[3]) || 0,
        fuelAllowance: Number(watched[4]) || 0,
        loanDeduction: Number(watched[5]) || 0,
        advanceDeduction: Number(watched[6]) || 0,
        fineDeduction: Number(watched[7]) || 0,
        healthDeduction: Number(watched[8]) || 0,
      }),
    [watched],
  )

  const incrementPreview = useMemo(() => {
    if (currentLumpsum == null || newLumpsum <= currentLumpsum) return null
    const diff = newLumpsum - currentLumpsum
    const pct = currentLumpsum > 0 ? ((diff / currentLumpsum) * 100).toFixed(1) : '—'
    return { diff, pct }
  }, [currentLumpsum, newLumpsum])

  const needsApproval = useNeedsPayApproval()
  const [approver, setApprover] = useState<EmployeeApproverTarget>()
  const mutation = useMutation({
    mutationFn: (values: IncrementFormValues) =>
      payrollApi.increment({
        ...values,
        effectiveFrom: firstOfMonthIso(values.effectiveFrom),
        approverTarget: approver,
      }),
    onSuccess: (res) => {
      toast({
        title: isPendingApproval(res)
          ? `Sent to ${res.approverLabel} for approval`
          : 'Stipend package updated successfully',
      })
      form.reset({
        employeeId: '',
        ...DEFAULT_STIPEND_VALUES,
        effectiveFrom: firstOfCurrentMonthIso(),
        reason: '',
      })
      setCurrentLumpsum(null)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to update stipend',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const handleEmployeeSelect = async (id: string) => {
    form.setValue('employeeId', id)
    if (id) {
      const employee = await employeesApi.getOne(id)
      const stipend = employee.stipendRecords?.[0]
      if (stipend) {
        form.setValue('basicStipend', Number(stipend.basicStipend) || 0)
        form.setValue('allowances', Number(stipend.allowances) || 0)
        form.setValue('reward', Number(stipend.reward) || 0)
        form.setValue('progressReward', Number(stipend.progressReward) || 0)
        form.setValue('fuelAllowance', Number(stipend.fuelAllowance) || 0)
        form.setValue('loanDeduction', Number(stipend.loanDeduction) || 0)
        form.setValue('advanceDeduction', Number(stipend.advanceDeduction) || 0)
        form.setValue('fineDeduction', Number(stipend.fineDeduction) || 0)
        form.setValue('healthDeduction', Number(stipend.healthDeduction) || 0)
        setCurrentLumpsum(
          stipend.lumpsumTotal != null
            ? Number(stipend.lumpsumTotal)
            : calculateLumpsumTotal({
                basicStipend: Number(stipend.basicStipend) || 0,
                allowances: Number(stipend.allowances) || 0,
                reward: Number(stipend.reward) || 0,
                progressReward: Number(stipend.progressReward) || 0,
                fuelAllowance: Number(stipend.fuelAllowance) || 0,
                loanDeduction: Number(stipend.loanDeduction) || 0,
                advanceDeduction: Number(stipend.advanceDeduction) || 0,
                fineDeduction: Number(stipend.fineDeduction) || 0,
                healthDeduction: Number(stipend.healthDeduction) || 0,
              }),
        )
      } else {
        setCurrentLumpsum(null)
      }
    } else {
      setCurrentLumpsum(null)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        className="mx-auto max-w-2xl space-y-4"
      >
        <FormField
          control={form.control}
          name="employeeId"
          render={({ field }) => (
            <FormItem>
              <EmployeeSearchSelect
                value={field.value}
                onChange={handleEmployeeSelect}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        {currentLumpsum !== null && (
          <div className="rounded-lg border border-border bg-surface p-3">
            <Label className="text-text-secondary">Current Lumpsum Total</Label>
            <p className="text-lg font-semibold">{formatPKR(currentLumpsum)}</p>
          </div>
        )}

        <StipendPackageFields control={form.control} watch={form.watch} />

        {incrementPreview && (
          <p className="text-sm text-accent-dark">
            Package increase: {formatPKR(incrementPreview.diff)} (
            {incrementPreview.pct}%)
          </p>
        )}

        <p className="text-sm text-text-secondary">
          Increments always start on the <strong>1st</strong> of the chosen
          month (mid-month dates are snapped). To correct amounts without
          a new package, use the employee profile → Edit Payroll (leave
          increment unticked).
        </p>

        <FormField
          control={form.control}
          name="effectiveFrom"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Effective month (always the 1st)</FormLabel>
              <FormControl>
                <DateInput
                  value={field.value ?? ''}
                  onChange={(v) => field.onChange(firstOfMonthIso(v))}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              </FormControl>
              <p className="text-xs text-text-secondary">
                Pick any day in the target month — the system uses the 1st.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reason</FormLabel>
              <FormControl>
                <Textarea {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {needsApproval ? (
          <ApproverSelect value={approver} onChange={setApprover} id="increment-approver" />
        ) : null}

        <Button
          type="submit"
          className="w-full bg-primary hover:bg-primary-dark"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Updating...' : 'Submit Stipend Update'}
        </Button>
      </form>
    </Form>
  )
}

function SummaryTab() {
  const now = new Date()
  const [monthYear, setMonthYear] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })
  const [branchId, setBranchId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [reportLoading, setReportLoading] = useState(false)

  const monthLabel = format(
    new Date(monthYear.year, monthYear.month - 1),
    'MMMM yyyy',
  )
  const daysInMonth = new Date(monthYear.year, monthYear.month, 0).getDate()
  const monthMin = `${monthYear.year}-${String(monthYear.month).padStart(2, '0')}-01`
  const monthMax = `${monthYear.year}-${String(monthYear.month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`

  const rangeReady = Boolean(fromDate && toDate)
  const dateRangeError =
    fromDate && toDate && toDate < fromDate
      ? 'To date must be on or after from date'
      : ''

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: summary, isLoading } = useQuery({
    queryKey: [
      'payroll-summary',
      monthYear,
      branchId,
      rangeReady ? fromDate : '',
      rangeReady ? toDate : '',
    ],
    queryFn: () =>
      payrollApi.getSummary(
        monthYear.month,
        monthYear.year,
        branchId || undefined,
        rangeReady ? fromDate : undefined,
        rangeReady ? toDate : undefined,
      ),
    enabled: !dateRangeError,
  })

  const paidPercent =
    summary && summary.totalEmployees > 0
      ? Math.round((summary.byStatus.PAID / summary.totalEmployees) * 100)
      : 0

  const employees = summary?.employees ?? []
  const paidEmployees = employees.filter((emp) => emp.paymentIncluded)
  const notPaidEmployees = employees.filter((emp) => !emp.paymentIncluded)
  const hasDateRange = Boolean(summary?.fromDate && summary?.toDate)

  const handleMonthYearChange = (next: { month: number; year: number }) => {
    setMonthYear(next)
    setFromDate('')
    setToDate('')
  }

  const generateReport = async () => {
    if (!branchId) {
      toast({
        title: 'Select a branch',
        description: 'Choose a branch before generating the payroll report.',
        variant: 'destructive',
      })
      return
    }
    setReportLoading(true)
    try {
      const blob = await payrollApi.downloadReport(
        branchId,
        monthYear.month,
        monthYear.year,
      )
      const branch = branches.find((b) => b.id === branchId)
      const label = branch ? formatBranchLabel(branch) : 'Branch'
      const safe = label.replace(/[^\w\- ]+/g, '').trim() || 'Branch'
      const mm = String(monthYear.month).padStart(2, '0')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Payroll-${safe}-${monthYear.year}-${mm}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: 'Payroll report downloaded' })
    } catch {
      toast({
        title: 'Failed to generate report',
        variant: 'destructive',
      })
    } finally {
      setReportLoading(false)
    }
  }

  const kpiCards = [
    {
      label: 'Employees getting paid',
      value: summary?.totalEmployees ?? 0,
    },
    {
      label: 'Total Basic Stipend',
      value: formatPKR(summary?.totalBasicStipend ?? 0),
    },
    {
      label: 'Total Allowances',
      value: formatPKR(summary?.totalAllowances ?? 0),
    },
    {
      label: 'Total Deductions',
      value: formatPKR(Math.max(0, summary?.totalDeductions ?? 0)),
    },
    {
      label: 'Total Net Stipend',
      value: formatPKR(summary?.totalNetStipend ?? 0),
    },
    ...(hasDateRange
      ? [
          {
            label: `Period stipend (${summary?.periodDays ?? 0} days)`,
            value: formatPKR(summary?.periodTotals?.periodStipend ?? 0),
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 no-print">
        <div className="flex flex-wrap items-end gap-3">
          <MonthYearPicker value={monthYear} onChange={handleMonthYearChange} />
          <div className="space-y-1">
            <Label>Branch</Label>
            <Select
              value={branchId || 'all'}
              onValueChange={(v) => setBranchId(v === 'all' ? '' : v)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {formatBranchLabel(b)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>From</Label>
            <DateInput
              value={fromDate}
              onChange={setFromDate}
              min={monthMin}
              max={monthMax}
              className="w-[150px]"
            />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <DateInput
              value={toDate}
              onChange={setToDate}
              min={monthMin}
              max={monthMax}
              className="w-[150px]"
            />
          </div>
          {(fromDate || toDate) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setFromDate('')
                setToDate('')
              }}
            >
              Clear dates
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="default"
            onClick={generateReport}
            disabled={reportLoading || !branchId}
          >
            {reportLoading ? 'Generating…' : 'Generate report'}
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            Print Summary
          </Button>
        </div>
      </div>

      {dateRangeError ? (
        <p className="text-sm text-destructive no-print">{dateRangeError}</p>
      ) : null}
      {fromDate && !toDate ? (
        <p className="text-sm text-text-secondary no-print">
          Select both From and To to apply the period stipend filter.
        </p>
      ) : null}

      <div id="payroll-summary-print" className="print-content">
        <div className="hidden print:block print-summary-header mb-6 text-center">
          <h2 className="text-xl font-bold">YCDO Central Hospital</h2>
          <p className="text-lg">Payroll Report — {monthLabel}</p>
          {hasDateRange ? (
            <p className="text-sm">
              Period: {summary?.fromDate} to {summary?.toDate} (
              {summary?.periodDays} days)
            </p>
          ) : null}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : summary ? (
          <>
            <div
              className={cn(
                'grid grid-cols-1 gap-4 md:grid-cols-2',
                hasDateRange ? 'xl:grid-cols-6' : 'xl:grid-cols-5',
              )}
            >
              {kpiCards.map((card) => (
                <Card key={card.label}>
                  <CardContent className="p-6">
                    <p className="text-2xl font-bold">{card.value}</p>
                    <p className="text-sm text-text-secondary">{card.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="mt-6">
              <CardContent className="space-y-4 p-6">
                <h3 className="font-semibold print:block hidden">
                  Payroll Status Breakdown
                </h3>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-amber-600">
                      {summary.byStatus.PENDING}
                    </p>
                    <p className="text-sm text-text-secondary">Pending</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-blue-600">
                      {summary.byStatus.PROCESSED}
                    </p>
                    <p className="text-sm text-text-secondary">Processed</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-600">
                      {summary.byStatus.PAID}
                    </p>
                    <p className="text-sm text-text-secondary">Paid</p>
                  </div>
                </div>

                {summary.byEmployeeStatus ? (
                  <div className="border-t border-border pt-4">
                    <h3 className="mb-3 font-semibold">
                      Employee Status Breakdown
                    </h3>
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
                      {EMPLOYEE_STATUSES.map((status) => (
                        <div
                          key={status}
                          className="rounded-md border border-border p-3"
                        >
                          <p className="text-lg font-semibold">
                            {summary.byEmployeeStatus[status] ?? 0}
                          </p>
                          <p className="text-xs text-text-secondary">
                            {employeeStatusLabel(status)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-2xl font-bold text-green-700">
                      {paidEmployees.length}
                    </p>
                    <p className="text-text-secondary">
                      Employees included in this payroll
                    </p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-700">
                      {notPaidEmployees.length}
                    </p>
                    <p className="text-text-secondary">
                      Employees not paid in this report
                    </p>
                  </div>
                </div>

                <div className="space-y-2 no-print">
                  <div className="flex justify-between text-sm">
                    <span>Payroll marked as PAID</span>
                    <span className="font-medium">{paidPercent}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-green-500 transition-all"
                      style={{ width: `${paidPercent}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="mt-6">
              <CardContent className="p-0">
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <h3 className="font-semibold">
                    Payroll Report Detail
                    {hasDateRange
                      ? ` — period stipend (${summary.periodDays} days)`
                      : ''}
                  </h3>
                  <TableRecordCount
                    count={employees.length}
                    label="employee"
                  />
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Employee Status</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead className="text-right">Basic</TableHead>
                        <TableHead className="text-right">Deductions</TableHead>
                        <TableHead className="text-right">Allowances</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Days</TableHead>
                        <TableHead className="text-right">
                          Period stipend
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employees.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={10}
                            className="py-8 text-center text-text-secondary"
                          >
                            No payroll entries for this period
                          </TableCell>
                        </TableRow>
                      ) : (
                        employees.map((emp) => (
                          <TableRow key={emp.entryId}>
                            <TableCell>
                              <EmployeeNameLink
                                employee={{
                                  id: emp.employeeId,
                                  fullName: emp.fullName,
                                  employeeCode: emp.employeeCode,
                                }}
                              />
                              <p className="text-xs text-text-secondary">
                                {emp.employeeCode}
                              </p>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {employeeStatusLabel(emp.employeeStatus)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {emp.paymentIncluded ? (
                                <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                                  Included
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-slate-600">
                                  Not on payroll
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatPKR(emp.basicStipend)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatPKR(Math.max(0, emp.totalDeductions))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatPKR(emp.totalAllowances)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {formatPKR(emp.netStipend)}
                            </TableCell>
                            <TableCell>
                              {emp.status ? (
                                <PayrollStatusBadge status={emp.status} />
                              ) : (
                                <span className="text-sm text-text-secondary">
                                  —
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {emp.periodDays}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {formatPKR(emp.periodStipend)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <p className="mt-8 hidden text-center text-xs text-text-secondary print:block">
              Generated by YCDO HRMS | {format(new Date(), 'dd/MM/yyyy HH:mm')}
            </p>
          </>
        ) : (
          <p className="text-text-secondary">No summary data available</p>
        )}
      </div>
    </div>
  )
}

function StipendReceiptStatusBadge({ status }: { status: StipendStatus }) {
  const config: Record<StipendStatus, { label: string; className: string }> = {
    PENDING: {
      label: 'Awaiting Response',
      className: 'bg-amber-100 text-amber-800 border-amber-200',
    },
    ACCEPTED: {
      label: 'Accepted',
      className: 'bg-green-100 text-green-800 border-green-200',
    },
    REJECTED: {
      label: 'Rejected',
      className: 'bg-red-100 text-red-800 border-red-200',
    },
    AUTO_ACCEPTED: {
      label: 'Auto-Accepted',
      className: 'bg-blue-100 text-blue-800 border-blue-200',
    },
  }
  const item = config[status]
  return (
    <Badge variant="outline" className={item.className}>
      {item.label}
    </Badge>
  )
}

function StipendReceiptsTab() {
  const queryClient = useQueryClient()
  const now = new Date()
  const [monthYear, setMonthYear] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['stipend-receipts', monthYear],
    queryFn: () =>
      stipendReceiptsApi.getAll({
        month: monthYear.month,
        year: monthYear.year,
      }),
  })

  const generateMutation = useMutation({
    mutationFn: () =>
      stipendReceiptsApi.generate({
        month: monthYear.month,
        year: monthYear.year,
      }),
    onSuccess: (result) => {
      toast({
        title: `${result.generated} receipts generated`,
      })
      queryClient.invalidateQueries({ queryKey: ['stipend-receipts'] })
      setGenerateOpen(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Generation failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const filtered = useMemo(() => {
    const list = receipts as StipendReceipt[]
    if (statusFilter === ALL) return list
    return list.filter((r) => r.status === statusFilter)
  }, [receipts, statusFilter])

  const { page, setPage, totalPages, paginated, total } = usePagination(
    filtered,
    [monthYear, statusFilter],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <MonthYearPicker value={monthYear} onChange={setMonthYear} />
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="ACCEPTED">Accepted</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="AUTO_ACCEPTED">Auto-Accepted</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={() => setGenerateOpen(true)}>Generate Receipts</Button>
      </div>

      <TableRecordCount count={total} label="stipend receipt" />

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Employee Status</TableHead>
              <TableHead>Month/Year</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Generated</TableHead>
              <TableHead>Responded</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(8)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-text-secondary">
                  No stipend receipts found
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((receipt) => (
                <Fragment key={receipt.id}>
                  <TableRow>
                    <TableCell>
                      <EmployeeNameLink employee={receipt.employee} />
                    </TableCell>
                    <TableCell>
                      {receipt.employee?.status ? (
                        <StatusBadge status={receipt.employee.status} />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {receipt.month}/{receipt.year}
                    </TableCell>
                    <TableCell>{formatPKR(receipt.amount)}</TableCell>
                    <TableCell>
                      <StipendReceiptStatusBadge status={receipt.status} />
                    </TableCell>
                    <TableCell>
                      {format(new Date(receipt.generatedAt), 'dd/MM/yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      {receipt.acceptedAt
                        ? format(new Date(receipt.acceptedAt), 'dd/MM/yyyy HH:mm')
                        : receipt.rejectedAt
                          ? format(new Date(receipt.rejectedAt), 'dd/MM/yyyy HH:mm')
                          : receipt.autoAcceptedAt
                            ? format(
                                new Date(receipt.autoAcceptedAt),
                                'dd/MM/yyyy HH:mm',
                              )
                            : '—'}
                    </TableCell>
                    <TableCell>
                      {receipt.status === 'REJECTED' && receipt.rejectionReason && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setExpandedId(
                              expandedId === receipt.id ? null : receipt.id,
                            )
                          }
                        >
                          {expandedId === receipt.id ? 'Hide' : 'Reason'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {expandedId === receipt.id && receipt.rejectionReason && (
                    <TableRow key={`${receipt.id}-reason`}>
                      <TableCell colSpan={8} className="bg-red-50 text-sm text-red-800">
                        Rejection reason: {receipt.rejectionReason}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>

        <TablePagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPageChange={setPage}
        />
      </div>

      <ConfirmDialog
        open={generateOpen}
        title="Generate Stipend Receipts"
        description={`Generate stipend receipts for ${monthYear.month}/${monthYear.year} for all active employees?`}
        confirmLabel="Generate"
        loading={generateMutation.isPending}
        onConfirm={() => generateMutation.mutate()}
        onCancel={() => setGenerateOpen(false)}
      />
    </div>
  )
}

/** Payslip printing for resigned / terminated / other non-active employees. */
function NonActivePayslipsTab() {
  const now = new Date()
  const [monthYear, setMonthYear] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['payroll-entries', { month: monthYear.month, year: monthYear.year }],
    queryFn: () =>
      payrollApi.getEntries({ month: monthYear.month, year: monthYear.year }),
  })

  const nonActiveEntries = useMemo(
    () =>
      entries.filter((e) => {
        const status = e.stipendRecord?.employee?.status
        return (
          e.forcedNonActive === true ||
          (!!status && status !== 'ACTIVE' && status !== 'ON_REST')
        )
      }),
    [entries],
  )

  const [printSlips, setPrintSlips] = useState<PayslipSlipData[] | null>(null)
  const clearPrintSlips = useCallback(() => setPrintSlips(null), [])
  const printMutation = useMutation({
    mutationFn: (ids: string[]) =>
      payrollApi.getPayslips(ids).then((rows) => ({ ids, rows })),
    onSuccess: ({ ids, rows }) => {
      const byId = new Map(rows.map((row) => [row.entryId, row.slip]))
      setPrintSlips(
        ids
          .map((id) => byId.get(id))
          .filter((slip): slip is PayslipSlipData => !!slip),
      )
    },
    onError: (err) =>
      toast({
        title: 'Could not load payslips',
        description: getApiErrorMessage(err, 'Please try again'),
        variant: 'destructive',
      }),
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-4 pt-6">
          <div className="space-y-1">
            <MonthYearPicker value={monthYear} onChange={setMonthYear} />
            <p className="text-xs text-text-secondary">
              Resigned, terminated and other non-active employees whose payroll
              entry was created for this month. Use "Add entry for employee" on
              Monthly Payroll to add more.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={nonActiveEntries.length === 0 || printMutation.isPending}
            onClick={() => printMutation.mutate(nonActiveEntries.map((e) => e.id))}
          >
            <Printer className="mr-2 h-4 w-4" />
            {printMutation.isPending
              ? 'Preparing…'
              : `Print all payslips (${nonActiveEntries.length})`}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Net stipend</TableHead>
                <TableHead>Payroll</TableHead>
                <TableHead className="text-right">Payslip</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ) : nonActiveEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-text-secondary">
                    No non-active employee payroll for this month.
                  </TableCell>
                </TableRow>
              ) : (
                nonActiveEntries.map((entry) => {
                  const emp = entry.stipendRecord?.employee
                  return (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <EmployeeNameLink employee={emp} />
                        <p className="font-mono text-xs text-text-secondary">
                          {emp?.employeeCode ?? '—'}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 text-amber-800"
                        >
                          {emp?.status
                            ? employeeStatusLabel(emp.status as EmployeeStatus)
                            : '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPKR(entry.netStipend)}
                      </TableCell>
                      <TableCell>
                        <PayrollStatusBadge status={entry.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={printMutation.isPending}
                          onClick={() => printMutation.mutate([entry.id])}
                        >
                          <Printer className="mr-1 h-4 w-4" />
                          Print
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {printSlips && printSlips.length > 0 && (
        <PayslipPrintSheet slips={printSlips} onDone={clearPrintSlips} />
      )}
    </div>
  )
}

export function PayrollPage() {
  const canEditPay = useCanEditPay()
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-text-primary sm:text-2xl">Payroll</h1>

      <Tabs defaultValue="monthly">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="monthly">Monthly Payroll</TabsTrigger>
          <TabsTrigger value="increment">Stipend Increment</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="receipts">Stipend Receipts</TabsTrigger>
          <TabsTrigger value="non-active">Non-active Payslips</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="types">Allowance &amp; Incentive Types</TabsTrigger>
        </TabsList>

        <TabsContent value="monthly" className="mt-4">
          <MonthlyPayrollTab />
        </TabsContent>

        <TabsContent value="increment" className="mt-4">
          {canEditPay ? (
            <StipendIncrementTab />
          ) : (
            <p className="rounded-md border border-border bg-muted/40 p-4 text-sm text-text-secondary">
              Salary changes are made by Finance (Payroll Officer). HR sets the salary only when
              adding a new employee.
            </p>
          )}
        </TabsContent>

        <TabsContent value="summary" className="mt-4">
          <SummaryTab />
        </TabsContent>

        <TabsContent value="receipts" className="mt-4">
          <StipendReceiptsTab />
        </TabsContent>

        <TabsContent value="non-active" className="mt-4">
          <NonActivePayslipsTab />
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          <PayrollReportsTab />
        </TabsContent>

        <TabsContent value="types" className="mt-4">
          <PayTypesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
