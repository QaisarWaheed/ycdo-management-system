import { Fragment, useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { differenceInCalendarDays, format } from 'date-fns'
import { AlertTriangle, Users } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { employeesApi } from '@/api/endpoints/employees'
import { leaveApi } from '@/api/endpoints/leave'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { ApprovalTrail } from '@/components/leave/ApprovalTrail'
import {
  ApproveRejectDialog,
  canApproveLeave,
  canAssignReliever,
  type ApprovalRole,
} from '@/components/leave/ApproveRejectDialog'
import { StageBadge } from '@/components/leave/StageBadge'
import { TablePagination } from '@/components/common/TablePagination'
import { TableRecordCount } from '@/components/common/TableRecordCount'
import { DateInput } from '@/components/common/DateInput'
import { SearchableSelect } from '@/components/common/SearchableSelect'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
import { MonthYearPicker } from '@/components/common/MonthYearPicker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
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
import { usePagination } from '@/hooks/usePagination'
import { getHierarchyPriority } from '@/lib/employeeHierarchy'
import { useAuthStore } from '@/store/auth.store'
import { cn } from '@/lib/utils'
import {
  LEAVE_TYPE_OPTIONS,
  labelToLeaveType,
  leaveTypeToLabel,
} from '@/lib/searchableSelectOptions'
import { hasShiftConflict } from '@/lib/shiftUtils'
import type { Employee, LeaveRecord } from '@/types'

const ALL = 'ALL'

const HR_ROLES = [
  'SUPER_ADMIN',
  'HR_MANAGER',
  'HR_ADMIN_MANAGER',
  'HR_OPERATIONS_MANAGER',
] as const

function canMarkEmergencyLeave(role?: string) {
  return !!role && HR_ROLES.includes(role as (typeof HR_ROLES)[number])
}

function LeaveStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
    BRANCH_APPROVED: 'bg-blue-100 text-blue-800 border-blue-200',
    DEPT_APPROVED: 'bg-purple-100 text-purple-800 border-purple-200',
    HR_PENDING: 'bg-orange-100 text-orange-800 border-orange-200',
    RELIEVER_PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
    RELIEVER_CONFIRMED: 'bg-blue-100 text-blue-800 border-blue-200',
    RELIEVER_REJECTED: 'bg-red-100 text-red-800 border-red-200',
    APPROVED: 'bg-green-100 text-green-800 border-green-200',
    REJECTED: 'bg-red-100 text-red-800 border-red-200',
    CANCELLED: 'bg-gray-100 text-gray-700 border-gray-200',
  }
  return (
    <Badge variant="outline" className={styles[status] ?? ''}>
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}

function AssignmentTypeBadge({ status }: { status: string | null }) {
  if (status === 'ACCEPTED') {
    return (
      <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
        Employee Accepted
      </Badge>
    )
  }
  if (status === 'HR_ASSIGNED') {
    return (
      <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">
        HR Assigned
      </Badge>
    )
  }
  return <span>—</span>
}

function TodayRelieversModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['today-relievers'],
    queryFn: () => leaveApi.getTodayRelievers(),
    enabled: open,
  })

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const aPriority = getHierarchyPriority(a.employee.designation ?? '')
        const bPriority = getHierarchyPriority(b.employee.designation ?? '')
        if (aPriority !== bPriority) return aPriority - bPriority
        return a.employee.fullName.localeCompare(b.employee.fullName)
      }),
    [rows],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Today&apos;s Relievers</DialogTitle>
        </DialogHeader>
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee on Leave</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Reliever</TableHead>
                <TableHead>Reliever Dept</TableHead>
                <TableHead>Assignment Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(5)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-text-secondary">
                    No employees on leave with relievers today
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <div>
                        <EmployeeNameLink
                          employee={row.employee}
                          name={row.employee.name}
                        />
                        <p className="font-mono text-xs text-text-secondary">
                          {row.employee.code}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{row.employee.department ?? '—'}</TableCell>
                    <TableCell>
                      {row.reliever ? (
                        <div>
                          <EmployeeNameLink
                            name={row.reliever.name}
                          />
                          <p className="font-mono text-xs text-text-secondary">
                            {row.reliever.code}
                          </p>
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{row.reliever?.department ?? '—'}</TableCell>
                    <TableCell>
                      <AssignmentTypeBadge status={row.relieverRequestStatus} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function HRAssignRelieverDialog({
  leave,
  open,
  onOpenChange,
}: {
  leave: LeaveRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [relieverId, setRelieverId] = useState('')
  const [selectedReliever, setSelectedReliever] = useState<Employee | undefined>()

  const employeeId = leave?.employeeId ?? ''

  const { data: requesterEmployee } = useQuery({
    queryKey: ['employee-shift', employeeId],
    queryFn: () => employeesApi.getOne(employeeId),
    enabled: open && !!employeeId,
  })

  const employeeName = leave?.employee
    ? leave.employee.fullName
    : ''

  const shiftConflict = hasShiftConflict(
    requesterEmployee?.shift,
    selectedReliever?.shift,
  )

  const mutation = useMutation({
    mutationFn: () =>
      leaveApi.hrAssignReliever(leave!.id, { relieverId }),
    onSuccess: () => {
      toast({ title: 'Reliever assigned. Awaiting HR Operations approval.' })
      queryClient.invalidateQueries({ queryKey: ['leave'] })
      setRelieverId('')
      setSelectedReliever(undefined)
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to assign reliever',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  if (!leave) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Reliever for {employeeName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-border bg-surface p-3">
            <p>
              <span className="text-text-secondary">Leave dates: </span>
              {format(new Date(leave.startDate), 'dd/MM/yyyy')} —{' '}
              {format(new Date(leave.endDate), 'dd/MM/yyyy')}
            </p>
            <p className="mt-1">
              <span className="text-text-secondary">Reason: </span>
              {leave.reason ?? '—'}
            </p>
          </div>
          <EmployeeSearchSelect
            label="Select Reliever"
            value={relieverId}
            onChange={(id, emp) => {
              setRelieverId(id)
              setSelectedReliever(emp)
            }}
          />
          <p className="text-xs text-text-secondary">
            Only shift-compatible employees will work
          </p>
          {selectedReliever?.shift && (
            <p className="text-sm">
              {selectedReliever.fullName} — Shift:{' '}
              {selectedReliever.shift.startTime} to {selectedReliever.shift.endTime}
            </p>
          )}
          {shiftConflict && (
            <p className="text-sm text-red-600">
              This employee&apos;s shift conflicts with yours. Please select a
              different reliever.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!relieverId || shiftConflict || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Assigning...' : 'Assign Reliever'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LeaveRequestsTab({ onOpenToday }: { onOpenToday: () => void }) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const now = new Date()

  const [employeeId, setEmployeeId] = useState('')
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [monthYear, setMonthYear] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })
  const [approveLeave, setApproveLeave] = useState<LeaveRecord | null>(null)
  const [expandedLeaveId, setExpandedLeaveId] = useState<string | null>(null)
  const [assignLeave, setAssignLeave] = useState<LeaveRecord | null>(null)
  const [emergencyOpen, setEmergencyOpen] = useState(false)

  const filters = useMemo(
    () => ({
      employeeId: employeeId || undefined,
      status: statusFilter !== ALL ? statusFilter : undefined,
      month: monthYear.month,
      year: monthYear.year,
    }),
    [employeeId, statusFilter, monthYear],
  )

  const { data: leaves = [], isLoading } = useQuery({
    queryKey: ['leave', filters],
    queryFn: () => leaveApi.getAll(filters),
  })

  const leaveRecords = leaves as LeaveRecord[]

  const { page, setPage, totalPages, paginated, total } = usePagination(
    leaveRecords,
    [filters],
  )

  const approvalRole: ApprovalRole | null = approveLeave
    ? canApproveLeave(user?.role, approveLeave)
    : null

  const showAssignButton = (leave: LeaveRecord) =>
    canAssignReliever(user?.role, leave)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <EmployeeSearchSelect
              label="Employee"
              value={employeeId}
              onChange={(id) => setEmployeeId(id)}
              placeholder="Filter by employee..."
            />
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="BRANCH_APPROVED">Branch Approved</SelectItem>
                <SelectItem value="DEPT_APPROVED">Dept Approved</SelectItem>
                <SelectItem value="RELIEVER_PENDING">Reliever Pending</SelectItem>
                <SelectItem value="RELIEVER_CONFIRMED">Reliever Confirmed</SelectItem>
                <SelectItem value="HR_PENDING">HR Pending</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <MonthYearPicker value={monthYear} onChange={setMonthYear} />
        </div>
        <div className="flex flex-wrap gap-2">
          {canMarkEmergencyLeave(user?.role) && (
            <Button
              variant="outline"
              className="border-amber-300 text-amber-800 hover:bg-amber-50"
              onClick={() => setEmergencyOpen(true)}
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              Mark Emergency Leave
            </Button>
          )}
          <Button variant="outline" onClick={onOpenToday}>
            <Users className="mr-2 h-4 w-4" />
            Today&apos;s Relievers
          </Button>
        </div>
      </div>

      <TableRecordCount count={total} label="leave request" />

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Applied On</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Current Stage</TableHead>
              <TableHead>Reliever</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(10)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-32 text-center text-text-secondary">
                  No leave requests found
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((leave) => (
                <Fragment key={leave.id}>
                  <TableRow>
                    <TableCell>
                      <div>
                        <EmployeeNameLink employee={leave.employee} />
                        <p className="font-mono text-xs text-text-secondary">
                          {leave.employee?.employeeCode ?? '—'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {leave.createdAt
                        ? format(new Date(leave.createdAt), 'dd/MM/yyyy')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {format(new Date(leave.startDate), 'dd/MM/yyyy')}
                    </TableCell>
                    <TableCell>
                      {format(new Date(leave.endDate), 'dd/MM/yyyy')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{leave.totalDays}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate">
                      {leave.reason ?? '—'}
                    </TableCell>
                    <TableCell>
                      <LeaveStatusBadge status={leave.status} />
                    </TableCell>
                    <TableCell>
                      <StageBadge
                        status={leave.status}
                        currentStage={leave.currentStage}
                      />
                    </TableCell>
                    <TableCell>
                      <EmployeeNameLink
                        employee={leave.relieverRequest?.reliever}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setExpandedLeaveId(
                              expandedLeaveId === leave.id ? null : leave.id,
                            )
                          }
                        >
                          Trail
                        </Button>
                        {showAssignButton(leave) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAssignLeave(leave)}
                          >
                            Assign Reliever
                          </Button>
                        )}
                        {canApproveLeave(user?.role, leave) && (
                          <Button
                            size="sm"
                            className="bg-primary hover:bg-primary-dark"
                            onClick={() => setApproveLeave(leave)}
                          >
                            Review
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedLeaveId === leave.id && (
                    <TableRow>
                      <TableCell colSpan={10}>
                        <ApprovalTrail leave={leave} />
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

      <ApproveRejectDialog
        leave={approveLeave}
        role={approvalRole ?? 'SUPER_ADMIN'}
        open={!!approveLeave && !!approvalRole}
        onOpenChange={(open) => !open && setApproveLeave(null)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['leave'] })}
      />

      <HRAssignRelieverDialog
        leave={assignLeave}
        open={!!assignLeave}
        onOpenChange={(v) => !v && setAssignLeave(null)}
      />

      <EmergencyLeaveDialog
        open={emergencyOpen}
        onOpenChange={setEmergencyOpen}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['leave'] })}
      />
    </div>
  )
}

const emergencySchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  emergencyReason: z.string().min(10, 'Reason must be at least 10 characters'),
})

type EmergencyFormValues = z.infer<typeof emergencySchema>

function EmergencyLeaveDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const form = useForm<EmergencyFormValues>({
    resolver: zodResolver(emergencySchema),
    defaultValues: {
      employeeId: '',
      startDate: '',
      endDate: '',
      emergencyReason: '',
    },
  })

  const mutation = useMutation({
    mutationFn: (values: EmergencyFormValues) => leaveApi.markEmergency(values),
    onSuccess: () => {
      toast({ title: 'Emergency leave marked successfully' })
      form.reset()
      onOpenChange(false)
      onSuccess()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to mark emergency leave',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) form.reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark Emergency Leave</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="employeeId"
              render={({ field }) => (
                <FormItem>
                  <EmployeeSearchSelect
                    value={field.value}
                    onChange={(id) => field.onChange(id)}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <DateInput
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date</FormLabel>
                    <FormControl>
                      <DateInput
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="emergencyReason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Emergency Reason</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Describe the emergency (min 10 characters)"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-primary hover:bg-primary-dark"
                disabled={mutation.isPending}
              >
                {mutation.isPending ? 'Saving...' : 'Mark Emergency Leave'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

const applySchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  leaveType: z.enum(['REGULAR', 'SHORT_LEAVE', 'EMERGENCY']),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  reason: z.string().min(1, 'Reason is required'),
})

type ApplyFormValues = z.infer<typeof applySchema>

function ApplyLeaveTab({ onSuccess }: { onSuccess: () => void }) {
  const queryClient = useQueryClient()
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | undefined>()
  const [relieverId, setRelieverId] = useState('')
  const [selectedReliever, setSelectedReliever] = useState<Employee | undefined>()

  const form = useForm<ApplyFormValues>({
    resolver: zodResolver(applySchema),
    defaultValues: {
      employeeId: '',
      leaveType: 'REGULAR',
      startDate: '',
      endDate: '',
      reason: '',
    },
  })

  const leaveType = form.watch('leaveType')
  const startDate = form.watch('startDate')
  const endDate = form.watch('endDate')
  const year = startDate
    ? new Date(startDate).getFullYear()
    : new Date().getFullYear()

  const { data: balance } = useQuery({
    queryKey: ['leave-balance', selectedEmployeeId, year],
    queryFn: () => leaveApi.getBalance(selectedEmployeeId, year),
    enabled: !!selectedEmployeeId,
  })

  const daysPreview = useMemo(() => {
    if (!startDate) return null
    if (leaveType === 'SHORT_LEAVE') return 'same-day'
    if (!endDate) return null
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (end < start) return null
    return differenceInCalendarDays(end, start) + 1
  }, [startDate, endDate, leaveType])

  useEffect(() => {
    if (leaveType === 'SHORT_LEAVE' && startDate) {
      form.setValue('endDate', startDate)
    }
  }, [leaveType, startDate, form])

  const shiftConflict = hasShiftConflict(
    selectedEmployee?.shift,
    selectedReliever?.shift,
  )

  const mutation = useMutation({
    mutationFn: async (values: ApplyFormValues) => {
      const leave = await leaveApi.apply({
        ...values,
        endDate:
          values.leaveType === 'SHORT_LEAVE'
            ? values.startDate
            : values.endDate,
      })
      if (relieverId) {
        await leaveApi.requestReliever(leave.id, {
          leaveRecordId: leave.id,
          relieverId,
        })
      }
      return { leave, hadReliever: !!relieverId }
    },
    onSuccess: ({ hadReliever }) => {
      toast({
        title: hadReliever
          ? 'Leave request submitted. Reliever notification sent.'
          : 'Leave request submitted. HR will assign a reliever if needed.',
      })
      queryClient.invalidateQueries({ queryKey: ['leave'] })
      form.reset()
      setSelectedEmployeeId('')
      setSelectedEmployee(undefined)
      setRelieverId('')
      setSelectedReliever(undefined)
      onSuccess()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to apply leave',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

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
                onChange={(id, emp) => {
                  field.onChange(id)
                  setSelectedEmployeeId(id)
                  setSelectedEmployee(emp)
                  setRelieverId('')
                  setSelectedReliever(undefined)
                }}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        {balance && (
          <p
            className={cn(
              'rounded-lg border border-border bg-surface p-3 text-sm',
              balance.remaining < 5 && 'border-red-200 text-red-600',
            )}
          >
            Remaining: {balance.remaining} / {balance.totalAllowed} days this year
          </p>
        )}

        <FormField
          control={form.control}
          name="leaveType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Leave Type</FormLabel>
              <FormControl>
                <SearchableSelect
                  options={LEAVE_TYPE_OPTIONS}
                  value={leaveTypeToLabel(field.value)}
                  onChange={(label) =>
                    field.onChange(labelToLeaveType(label))
                  }
                  placeholder="Select leave type"
                  error={form.formState.errors.leaveType?.message}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {leaveType === 'REGULAR' && (
          <p className="text-sm text-text-secondary">
            Regular leave must be requested at least 48 hours in advance.
          </p>
        )}
        {leaveType === 'SHORT_LEAVE' && (
          <p className="text-sm text-text-secondary">
            Short leave is for a partial day absence. Maximum 2 short leaves per
            month.
          </p>
        )}
        {leaveType === 'EMERGENCY' && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Emergency leave does not require 48 hours notice and will be
            immediately processed.
          </p>
        )}

        <div
          className={cn(
            'grid gap-4',
            leaveType === 'SHORT_LEAVE' ? 'grid-cols-1' : 'grid-cols-2',
          )}
        >
          <FormField
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start Date</FormLabel>
                <FormControl>
                  <DateInput
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {leaveType !== 'SHORT_LEAVE' && (
            <FormField
              control={form.control}
              name="endDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>End Date</FormLabel>
                  <FormControl>
                    <DateInput
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        {daysPreview === 'same-day' && (
          <p className="text-sm text-text-secondary">Same day (short leave)</p>
        )}
        {typeof daysPreview === 'number' && (
          <p className="text-sm text-text-secondary">
            {daysPreview} day{daysPreview !== 1 ? 's' : ''} requested
          </p>
        )}

        {startDate && (leaveType === 'SHORT_LEAVE' || endDate) && (
          <div className="space-y-2 rounded-lg border border-border p-4">
            <EmployeeSearchSelect
              label="Select Reliever (Optional)"
              value={relieverId}
              onChange={(id, emp) => {
                setRelieverId(id)
                setSelectedReliever(emp)
              }}
            />
            <p className="text-xs text-text-secondary">
              Select an employee to cover your duties during leave. They will have
              8 hours to accept or reject.
            </p>
            {selectedReliever?.shift && (
              <p className="text-sm">
                {selectedReliever.fullName} — Shift:{' '}
                {selectedReliever.shift.startTime} to {selectedReliever.shift.endTime}
              </p>
            )}
            {shiftConflict && (
              <p className="text-sm text-red-600">
                This employee&apos;s shift conflicts with yours. Please select a
                different reliever.
              </p>
            )}
          </div>
        )}

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
          disabled={mutation.isPending || (relieverId !== '' && shiftConflict)}
        >
          {mutation.isPending ? 'Submitting...' : 'Apply Leave'}
        </Button>
      </form>
    </Form>
  )
}

export function LeavePage() {
  const [tab, setTab] = useState('requests')
  const [todayOpen, setTodayOpen] = useState(false)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Leave Management</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requests">Leave Requests</TabsTrigger>
          <TabsTrigger value="apply">Apply Leave</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-4">
          <LeaveRequestsTab onOpenToday={() => setTodayOpen(true)} />
        </TabsContent>

        <TabsContent value="apply" className="mt-4">
          <ApplyLeaveTab onSuccess={() => setTab('requests')} />
        </TabsContent>
      </Tabs>

      <TodayRelieversModal open={todayOpen} onOpenChange={setTodayOpen} />
    </div>
  )
}
