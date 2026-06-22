import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { differenceInCalendarDays, format } from 'date-fns'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { leaveApi } from '@/api/endpoints/leave'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
import { MonthYearPicker } from '@/components/common/MonthYearPicker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { useAuthStore } from '@/store/auth.store'
import { cn } from '@/lib/utils'
import type { LeaveRecord } from '@/types'

const ALL = 'ALL'

function LeaveStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
    APPROVED: 'bg-green-100 text-green-800 border-green-200',
    REJECTED: 'bg-red-100 text-red-800 border-red-200',
  }
  return (
    <Badge variant="outline" className={styles[status] ?? ''}>
      {status}
    </Badge>
  )
}

function LeaveRequestsTab() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const now = new Date()

  const [employeeId, setEmployeeId] = useState('')
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [monthYear, setMonthYear] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })
  const [confirmAction, setConfirmAction] = useState<{
    id: string
    action: 'APPROVED' | 'REJECTED'
  } | null>(null)

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

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string
      status: 'APPROVED' | 'REJECTED'
    }) =>
      leaveApi.updateStatus(id, {
        status,
        approvedBy: user?.email ?? 'HR Admin',
      }),
    onSuccess: (_, vars) => {
      toast({
        title:
          vars.status === 'APPROVED'
            ? 'Leave approved'
            : 'Leave rejected',
      })
      queryClient.invalidateQueries({ queryKey: ['leave'] })
      setConfirmAction(null)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Action failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <div className="space-y-4">
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
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Statuses</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <MonthYearPicker value={monthYear} onChange={setMonthYear} />
      </div>

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
            ) : leaves.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-text-secondary">
                  No leave requests found
                </TableCell>
              </TableRow>
            ) : (
              (leaves as LeaveRecord[]).map((leave) => (
                <TableRow key={leave.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">
                        {leave.employee
                          ? `${leave.employee.firstName} ${leave.employee.lastName}`
                          : '—'}
                      </p>
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
                  <TableCell className="max-w-[200px] truncate">
                    {leave.reason ?? '—'}
                  </TableCell>
                  <TableCell>
                    <LeaveStatusBadge status={leave.status} />
                  </TableCell>
                  <TableCell>
                    {leave.status === 'PENDING' && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                          onClick={() =>
                            setConfirmAction({ id: leave.id, action: 'APPROVED' })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            setConfirmAction({ id: leave.id, action: 'REJECTED' })
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={!!confirmAction}
        title={
          confirmAction?.action === 'APPROVED'
            ? 'Approve Leave'
            : 'Reject Leave'
        }
        description={
          confirmAction?.action === 'APPROVED'
            ? 'Are you sure you want to approve this leave request?'
            : 'Are you sure you want to reject this leave request?'
        }
        confirmLabel={confirmAction?.action === 'APPROVED' ? 'Approve' : 'Reject'}
        confirmVariant={
          confirmAction?.action === 'REJECTED' ? 'destructive' : 'default'
        }
        loading={updateMutation.isPending}
        onConfirm={() =>
          confirmAction &&
          updateMutation.mutate({
            id: confirmAction.id,
            status: confirmAction.action,
          })
        }
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}

const applySchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  reason: z.string().min(1, 'Reason is required'),
})

type ApplyFormValues = z.infer<typeof applySchema>

function ApplyLeaveTab({ onSuccess }: { onSuccess: () => void }) {
  const queryClient = useQueryClient()
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')

  const form = useForm<ApplyFormValues>({
    resolver: zodResolver(applySchema),
    defaultValues: {
      employeeId: '',
      startDate: '',
      endDate: '',
      reason: '',
    },
  })

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
    if (!startDate || !endDate) return null
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (end < start) return null
    return differenceInCalendarDays(end, start) + 1
  }, [startDate, endDate])

  const mutation = useMutation({
    mutationFn: (values: ApplyFormValues) => leaveApi.apply(values),
    onSuccess: () => {
      toast({ title: 'Leave application submitted' })
      queryClient.invalidateQueries({ queryKey: ['leave'] })
      form.reset()
      setSelectedEmployeeId('')
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
                onChange={(id) => {
                  field.onChange(id)
                  setSelectedEmployeeId(id)
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
            Remaining: {balance.remaining} / {balance.totalAllowed} days this
            year
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
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
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {daysPreview !== null && (
          <p className="text-sm text-text-secondary">
            {daysPreview} day{daysPreview !== 1 ? 's' : ''}
          </p>
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
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Submitting...' : 'Apply Leave'}
        </Button>
      </form>
    </Form>
  )
}

export function LeavePage() {
  const [tab, setTab] = useState('requests')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Leave Management</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requests">Leave Requests</TabsTrigger>
          <TabsTrigger value="apply">Apply Leave</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-4">
          <LeaveRequestsTab />
        </TabsContent>

        <TabsContent value="apply" className="mt-4">
          <ApplyLeaveTab onSuccess={() => setTab('requests')} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
