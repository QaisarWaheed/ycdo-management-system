import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { MoreHorizontal } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { branchesApi } from '@/api/endpoints/branches'
import { attendanceApi } from '@/api/endpoints/attendance'
import { employeesApi } from '@/api/endpoints/employees'
import { payrollApi } from '@/api/endpoints/payroll'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
import { MonthYearPicker } from '@/components/common/MonthYearPicker'
import { PKRInput } from '@/components/common/PKRInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
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
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  ALLOWANCE_TYPES,
  DEDUCTION_TYPES,
  type AllowanceType,
  type PayrollEntry,
  type PayrollStatus,
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

const deductionSchema = z.object({
  reason: z.enum([
    'LATE_ARRIVAL',
    'UNINFORMED_ABSENCE',
    'DISCIPLINARY_FINE',
    'OTHER',
  ]),
  amount: z.number().positive('Amount must be greater than 0'),
  description: z.string().optional(),
})

type DeductionFormValues = z.infer<typeof deductionSchema>

function AddDeductionForm({
  payrollEntryId,
  onSuccess,
}: {
  payrollEntryId: string
  onSuccess: () => void
}) {
  const form = useForm<DeductionFormValues>({
    resolver: zodResolver(deductionSchema),
    defaultValues: { reason: 'OTHER', amount: 0, description: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: DeductionFormValues) =>
      payrollApi.addDeduction({ payrollEntryId, ...values }),
    onSuccess: () => {
      toast({ title: 'Deduction added' })
      form.reset()
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
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        className="space-y-3 border-t border-border pt-4"
      >
        <p className="text-sm font-medium">Add Deduction</p>
        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reason</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {DEDUCTION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Amount</FormLabel>
              <FormControl>
                <PKRInput value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={mutation.isPending} size="sm">
          {mutation.isPending ? 'Adding...' : 'Add Deduction'}
        </Button>
      </form>
    </Form>
  )
}

function AddAllowanceForm({
  payrollEntryId,
  onSuccess,
}: {
  payrollEntryId: string
  onSuccess: () => void
}) {
  const [type, setType] = useState<AllowanceType>('CUSTOM')
  const [description, setDescription] = useState('')
  const [hours, setHours] = useState<number | undefined>()
  const [amount, setAmount] = useState(0)

  const mutation = useMutation({
    mutationFn: () =>
      payrollApi.addAllowance({
        payrollEntryId,
        type,
        description: description || undefined,
        hours,
        amount,
      }),
    onSuccess: () => {
      toast({ title: 'Allowance added' })
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
        <Label>Description</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Hours (optional)</Label>
        <Input
          type="number"
          value={hours ?? ''}
          onChange={(e) =>
            setHours(e.target.value ? Number(e.target.value) : undefined)
          }
        />
      </div>
      <div className="space-y-2">
        <Label>Amount</Label>
        <PKRInput value={amount} onChange={setAmount} />
      </div>
      <Button type="submit" disabled={mutation.isPending || amount <= 0} size="sm">
        {mutation.isPending ? 'Adding...' : 'Add Allowance'}
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

  const { data: fullEntry, refetch } = useQuery({
    queryKey: ['payroll-entry-full', entry?.id],
    queryFn: () => payrollApi.getEntryFull(entry!.id),
    enabled: !!entry && open,
  })

  const employeeId = fullEntry?.salaryRecord?.employee?.id

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

  const refresh = async () => {
    queryClient.invalidateQueries({ queryKey: ['payroll-entries'] })
    const updated = await refetch()
    if (updated.data) onRefresh(updated.data)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Payroll Detail</DialogTitle>
        </DialogHeader>

        <Tabs value={detailTab} onValueChange={setDetailTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="deductions">Deductions</TabsTrigger>
            <TabsTrigger value="allowances">Allowances</TabsTrigger>
          </TabsList>

          <TabsContent value="deductions" className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deductions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-text-secondary">
                      No deductions
                    </TableCell>
                  </TableRow>
                ) : (
                  deductions.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{d.reason.replace(/_/g, ' ')}</TableCell>
                      <TableCell className="text-red-600">
                        {formatPKR(d.amount)}
                      </TableCell>
                      <TableCell>{d.description ?? '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <p className="text-right font-semibold">
              Total Deductions: {formatPKR(totalDeductions)}
            </p>
            {entry.status === 'PENDING' && (
              <AddDeductionForm payrollEntryId={entry.id} onSuccess={refresh} />
            )}
          </TabsContent>

          <TabsContent value="allowances" className="space-y-4">
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
            {entry.status === 'PENDING' && (
              <AddAllowanceForm payrollEntryId={entry.id} onSuccess={refresh} />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function MonthlyPayrollTab() {
  const queryClient = useQueryClient()
  const now = new Date()

  const [monthYear, setMonthYear] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })
  const [branchId, setBranchId] = useState('')
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [viewEntry, setViewEntry] = useState<PayrollEntry | null>(null)
  const [addDeductionEntry, setAddDeductionEntry] = useState<PayrollEntry | null>(
    null,
  )
  const [confirmGenerate, setConfirmGenerate] = useState(false)
  const [confirmStatus, setConfirmStatus] = useState<{
    id: string
    status: PayrollStatus
  } | null>(null)

  const filters = useMemo(
    () => ({
      month: monthYear.month,
      year: monthYear.year,
      branchId: branchId || undefined,
      status: statusFilter !== ALL ? statusFilter : undefined,
    }),
    [monthYear, branchId, statusFilter],
  )

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['payroll-entries', filters],
    queryFn: () => payrollApi.getEntries(filters),
  })

  const generateMutation = useMutation({
    mutationFn: async () => {
      const employees = await employeesApi.getAll({
        status: 'ACTIVE',
        branchId: branchId || undefined,
      })
      for (const emp of employees) {
        await payrollApi.createEntry({
          employeeId: emp.id,
          month: monthYear.month,
          year: monthYear.year,
        })
      }
      return employees.length
    },
    onSuccess: (count) => {
      toast({ title: `Generated ${count} payroll entries` })
      queryClient.invalidateQueries({ queryKey: ['payroll-entries'] })
      queryClient.invalidateQueries({ queryKey: ['payroll-summary'] })
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

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PayrollStatus }) =>
      payrollApi.updateStatus(id, { status }),
    onSuccess: () => {
      toast({ title: 'Payroll status updated' })
      queryClient.invalidateQueries({ queryKey: ['payroll-entries'] })
      queryClient.invalidateQueries({ queryKey: ['payroll-summary'] })
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <MonthYearPicker value={monthYear} onChange={setMonthYear} />

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
                    {b.name}
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
        </div>

        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setConfirmGenerate(true)}
        >
          Generate Entries
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Basic Salary</TableHead>
              <TableHead>Deductions</TableHead>
              <TableHead>Allowances</TableHead>
              <TableHead>Net Salary</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(7)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-text-secondary">
                  No payroll entries for this period
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => {
                const emp = entry.salaryRecord?.employee
                return (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {emp
                            ? `${emp.firstName} ${emp.lastName}`
                            : '—'}
                        </p>
                        <p className="font-mono text-xs text-text-secondary">
                          {emp?.employeeCode ?? '—'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{formatPKR(entry.basicSalary)}</TableCell>
                    <TableCell
                      className={cn(
                        Number(entry.totalDeductions) > 0 && 'text-red-600',
                      )}
                    >
                      {formatPKR(entry.totalDeductions)}
                    </TableCell>
                    <TableCell>{formatPKR(entry.totalAllowances)}</TableCell>
                    <TableCell className="font-medium">
                      {formatPKR(entry.netSalary)}
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
                              <DropdownMenuItem
                                onClick={() => setAddDeductionEntry(entry)}
                              >
                                Add Deduction
                              </DropdownMenuItem>
                            </>
                          )}
                          {entry.status === 'PROCESSED' && (
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
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Deduction</DialogTitle>
            </DialogHeader>
            <AddDeductionForm
              payrollEntryId={addDeductionEntry.id}
              onSuccess={() => {
                queryClient.invalidateQueries({ queryKey: ['payroll-entries'] })
                setAddDeductionEntry(null)
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      <ConfirmDialog
        open={confirmGenerate}
        title="Generate Payroll Entries"
        description={`Create payroll entries for all active employees for ${format(new Date(monthYear.year, monthYear.month - 1), 'MMMM yyyy')}?`}
        confirmLabel="Generate"
        loading={generateMutation.isPending}
        onConfirm={() => generateMutation.mutate()}
        onCancel={() => setConfirmGenerate(false)}
      />

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

const incrementSchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  newBasicSalary: z.number().positive('Salary must be greater than 0'),
  effectiveFrom: z.string().min(1, 'Effective date is required'),
  reason: z.string().min(1, 'Reason is required'),
})

type IncrementFormValues = z.infer<typeof incrementSchema>

function SalaryIncrementTab() {
  const [currentSalary, setCurrentSalary] = useState<number | null>(null)

  const form = useForm<IncrementFormValues>({
    resolver: zodResolver(incrementSchema),
    defaultValues: {
      employeeId: '',
      newBasicSalary: 0,
      effectiveFrom: '',
      reason: '',
    },
  })

  const newSalary = form.watch('newBasicSalary')

  const incrementPreview = useMemo(() => {
    if (!currentSalary || !newSalary || newSalary <= currentSalary) return null
    const diff = newSalary - currentSalary
    const pct = ((diff / currentSalary) * 100).toFixed(1)
    return { diff, pct }
  }, [currentSalary, newSalary])

  const mutation = useMutation({
    mutationFn: (values: IncrementFormValues) => payrollApi.increment(values),
    onSuccess: () => {
      toast({ title: 'Salary updated successfully' })
      form.reset()
      setCurrentSalary(null)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to update salary',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const handleEmployeeSelect = async (id: string) => {
    form.setValue('employeeId', id)
    if (id) {
      const employee = await employeesApi.getOne(id)
      const salary = employee.salaryRecords?.[0]
      setCurrentSalary(salary ? Number(salary.basicSalary) : null)
    } else {
      setCurrentSalary(null)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        className="mx-auto max-w-lg space-y-4"
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

        {currentSalary !== null && (
          <div className="rounded-lg border border-border bg-surface p-3">
            <Label className="text-text-secondary">Current Salary</Label>
            <p className="text-lg font-semibold">{formatPKR(currentSalary)}</p>
          </div>
        )}

        <FormField
          control={form.control}
          name="newBasicSalary"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New Basic Salary</FormLabel>
              <FormControl>
                <PKRInput value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {incrementPreview && (
          <p className="text-sm text-accent-dark">
            Increment: {formatPKR(incrementPreview.diff)} (
            {incrementPreview.pct}%)
          </p>
        )}

        <FormField
          control={form.control}
          name="effectiveFrom"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Effective From</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
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

        <Button
          type="submit"
          className="w-full bg-primary hover:bg-primary-dark"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Updating...' : 'Submit Increment'}
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

  const monthLabel = format(new Date(monthYear.year, monthYear.month - 1), 'MMMM yyyy')

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: summary, isLoading } = useQuery({
    queryKey: ['payroll-summary', monthYear, branchId],
    queryFn: () =>
      payrollApi.getSummary(
        monthYear.month,
        monthYear.year,
        branchId || undefined,
      ),
  })

  const paidPercent =
    summary && summary.totalEmployees > 0
      ? Math.round((summary.byStatus.PAID / summary.totalEmployees) * 100)
      : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 no-print">
        <div className="flex flex-wrap items-end gap-3">
          <MonthYearPicker value={monthYear} onChange={setMonthYear} />
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
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          Print Summary
        </Button>
      </div>

      <div id="payroll-summary-print" className="print-content">
        <div className="hidden print:block print-summary-header mb-6 text-center">
          <h2 className="text-xl font-bold">YCDO Central Hospital</h2>
          <p className="text-lg">Payroll Summary — {monthLabel}</p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : summary ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: 'Total Employees on Payroll',
                  value: summary.totalEmployees,
                },
                {
                  label: 'Total Basic Salary',
                  value: formatPKR(summary.totalBasicSalary),
                },
                {
                  label: 'Total Deductions',
                  value: formatPKR(summary.totalDeductions),
                },
                {
                  label: 'Total Net Salary',
                  value: formatPKR(summary.totalNetSalary),
                },
              ].map((card) => (
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
                  Status Breakdown
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

export function PayrollPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Payroll</h1>

      <Tabs defaultValue="monthly">
        <TabsList>
          <TabsTrigger value="monthly">Monthly Payroll</TabsTrigger>
          <TabsTrigger value="increment">Salary Increment</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="monthly" className="mt-4">
          <MonthlyPayrollTab />
        </TabsContent>

        <TabsContent value="increment" className="mt-4">
          <SalaryIncrementTab />
        </TabsContent>

        <TabsContent value="summary" className="mt-4">
          <SummaryTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
