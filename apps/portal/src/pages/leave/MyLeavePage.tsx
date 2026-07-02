import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { differenceInCalendarDays, format } from 'date-fns'
import { AlertTriangle } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { employeesApi } from '@/api/endpoints/employees'
import { leaveApi, type IncomingRelieverRequest } from '@/api/endpoints/leave'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import {
  EmployeeSearchSelect,
  type RelieverCandidate,
} from '@/components/common/EmployeeSearchSelect'
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
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
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { hasShiftConflict } from '@/lib/shiftUtils'
import type { LeaveRecord } from '@/types'

function LeaveStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
    DEPT_APPROVED: 'bg-blue-100 text-blue-800 border-blue-200',
    RELIEVER_PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
    RELIEVER_CONFIRMED: 'bg-blue-100 text-blue-800 border-blue-200',
    RELIEVER_REJECTED: 'bg-red-100 text-red-800 border-red-200',
    APPROVED: 'bg-green-100 text-green-800 border-green-200',
    REJECTED: 'bg-red-100 text-red-800 border-red-200',
  }
  return (
    <Badge variant="outline" className={styles[status] ?? ''}>
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}

function RelieverStatusBadge({ status }: { status: string }) {
  if (status === 'RELIEVER_PENDING') {
    return (
      <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
        Reliever Notified
      </Badge>
    )
  }
  if (status === 'RELIEVER_CONFIRMED') {
    return (
      <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
        Reliever Confirmed
      </Badge>
    )
  }
  if (status === 'RELIEVER_REJECTED') {
    return (
      <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
        HR Assigning Reliever
      </Badge>
    )
  }
  return <span className="text-text-secondary">—</span>
}

function RelieverSelectDialog({
  leave,
  open,
  onOpenChange,
  employeeId,
  requesterShift,
}: {
  leave: LeaveRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeId: string
  requesterShift?: { startTime: string; endTime: string } | null
}) {
  const queryClient = useQueryClient()
  const [relieverId, setRelieverId] = useState('')
  const [selectedReliever, setSelectedReliever] = useState<
    RelieverCandidate | undefined
  >()

  const shiftConflict = hasShiftConflict(requesterShift, selectedReliever?.shift)

  const mutation = useMutation({
    mutationFn: () =>
      leaveApi.requestReliever(leave!.id, {
        leaveRecordId: leave!.id,
        relieverId,
      }),
    onSuccess: () => {
      toast({
        title: 'Reliever request sent',
        description: 'Awaiting response from the selected employee.',
      })
      queryClient.invalidateQueries({ queryKey: ['pending-reliever'] })
      queryClient.invalidateQueries({ queryKey: ['leave'] })
      setRelieverId('')
      setSelectedReliever(undefined)
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to request reliever',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  if (!leave) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select Reliever</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface p-3 text-sm">
            <p className="text-text-secondary">Leave dates</p>
            <p className="font-medium">
              {format(new Date(leave.startDate), 'dd/MM/yyyy')} —{' '}
              {format(new Date(leave.endDate), 'dd/MM/yyyy')}
            </p>
            <p className="mt-2 text-text-secondary">
              {leave.totalDays} day{leave.totalDays !== 1 ? 's' : ''}
              {leave.reason && ` · ${leave.reason}`}
            </p>
          </div>

          <EmployeeSearchSelect
            label="Select Reliever"
            value={relieverId}
            onChange={(id, emp) => {
              setRelieverId(id)
              setSelectedReliever(emp)
            }}
            excludeId={employeeId}
          />

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
            className="bg-primary hover:bg-primary-dark"
            disabled={!relieverId || shiftConflict || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Sending...' : 'Send Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RespondDialog({
  request,
  mode,
  open,
  onOpenChange,
}: {
  request: IncomingRelieverRequest | null
  mode: 'accept' | 'decline'
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () =>
      leaveApi.respondToReliever(request!.id, { accept: mode === 'accept' }),
    onSuccess: () => {
      toast({
        title:
          mode === 'accept'
            ? 'Reliever request accepted'
            : 'Reliever request declined',
      })
      queryClient.invalidateQueries({ queryKey: ['incoming-reliever'] })
      queryClient.invalidateQueries({ queryKey: ['leave'] })
      onOpenChange(false)
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

  if (!request) return null

  const name = request.requestedBy.fullName

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'accept' ? 'Accept Reliever Request' : 'Decline Reliever Request'}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-text-secondary">
          {mode === 'accept'
            ? `You are confirming to cover ${name}'s duties from ${format(new Date(request.leaveRecord.startDate), 'dd/MM/yyyy')} to ${format(new Date(request.leaveRecord.endDate), 'dd/MM/yyyy')}.`
            : 'Are you sure you want to decline this reliever request?'}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className={
              mode === 'accept'
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-red-600 hover:bg-red-700'
            }
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? 'Submitting...'
              : mode === 'accept'
                ? 'Accept'
                : 'Decline'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MyRequestsTab() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [cancelId, setCancelId] = useState<string | null>(null)

  const { data: leaves = [], isLoading } = useQuery({
    queryKey: ['leave', 'my'],
    queryFn: () => leaveApi.getMy(),
    enabled: !!user?.employeeId,
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => leaveApi.cancel(id),
    onSuccess: () => {
      toast({ title: 'Leave request cancelled' })
      queryClient.invalidateQueries({ queryKey: ['leave'] })
      setCancelId(null)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to cancel leave',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const sorted = useMemo(
    () =>
      [...(leaves as LeaveRecord[])].sort(
        (a, b) =>
          new Date(b.createdAt ?? b.startDate).getTime() -
          new Date(a.createdAt ?? a.startDate).getTime(),
      ),
    [leaves],
  )

  return (
    <>
      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reliever Status</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(7)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-text-secondary"
                >
                  No leave requests yet
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((leave) => (
                <TableRow key={leave.id}>
                  <TableCell>
                    {format(new Date(leave.startDate), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>
                    {format(new Date(leave.endDate), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>{leave.totalDays}</TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {leave.reason ?? '—'}
                  </TableCell>
                  <TableCell>
                    <LeaveStatusBadge status={leave.status} />
                  </TableCell>
                  <TableCell>
                    <RelieverStatusBadge status={leave.status} />
                  </TableCell>
                  <TableCell>
                    {leave.status === 'PENDING' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setCancelId(leave.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={!!cancelId}
        title="Cancel Leave Request"
        description="Are you sure you want to cancel this pending leave request?"
        confirmLabel="Cancel Request"
        confirmVariant="destructive"
        loading={cancelMutation.isPending}
        onConfirm={() => cancelId && cancelMutation.mutate(cancelId)}
        onCancel={() => setCancelId(null)}
      />
    </>
  )
}

const LEAVE_TYPES = ['REGULAR', 'SHORT_LEAVE', 'EMERGENCY'] as const

const applySchema = z
  .object({
    leaveType: z.enum(LEAVE_TYPES, { message: 'Leave type is required' }),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().optional(),
    reason: z
      .string()
      .min(1, 'Reason is required')
      .max(500, 'Reason must be 500 characters or less'),
  })
  .superRefine((data, ctx) => {
    if (data.leaveType === 'SHORT_LEAVE') return
    if (!data.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End date is required',
        path: ['endDate'],
      })
      return
    }
    if (new Date(data.endDate) < new Date(data.startDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End date must be on or after start date',
        path: ['endDate'],
      })
    }
  })

type ApplyFormValues = z.infer<typeof applySchema>

function ApplyLeaveTab({ onSuccess }: { onSuccess: () => void }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const employeeId = user?.employeeId ?? ''

  const [relieverId, setRelieverId] = useState('')
  const [selectedReliever, setSelectedReliever] = useState<
    RelieverCandidate | undefined
  >()

  const { data: employee } = useQuery({
    queryKey: ['employee-self', employeeId],
    queryFn: () => employeesApi.getOne(employeeId),
    enabled: !!employeeId,
  })

  const form = useForm<ApplyFormValues>({
    resolver: zodResolver(applySchema),
    defaultValues: {
      leaveType: 'REGULAR',
      startDate: '',
      endDate: '',
      reason: '',
    },
  })

  const leaveType = form.watch('leaveType')
  const startDate = form.watch('startDate')
  const endDate = form.watch('endDate')

  useEffect(() => {
    if (leaveType === 'SHORT_LEAVE' && startDate) {
      form.setValue('endDate', startDate)
    }
  }, [leaveType, startDate, form])
  const year = startDate
    ? new Date(startDate).getFullYear()
    : new Date().getFullYear()

  const { data: balance } = useQuery({
    queryKey: ['leave-balance', employeeId, year],
    queryFn: () => leaveApi.getMyBalance(employeeId, year),
    enabled: !!employeeId,
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

  const shiftConflict = hasShiftConflict(employee?.shift, selectedReliever?.shift)

  const mutation = useMutation({
    mutationFn: async (values: ApplyFormValues) => {
      const leave = await leaveApi.apply({
        employeeId,
        startDate: values.startDate,
        endDate:
          values.leaveType === 'SHORT_LEAVE'
            ? values.startDate
            : values.endDate!,
        reason: values.reason,
        leaveType: values.leaveType,
      })
      if (relieverId) {
        await leaveApi.requestReliever(leave.id, {
          leaveRecordId: leave.id,
          relieverId,
        })
      }
      return { hadReliever: !!relieverId }
    },
    onSuccess: ({ hadReliever }) => {
      toast({
        title: hadReliever
          ? 'Leave request submitted. Reliever notification sent.'
          : 'Leave request submitted. HR will assign a reliever if needed.',
      })
      queryClient.invalidateQueries({ queryKey: ['leave'] })
      queryClient.invalidateQueries({ queryKey: ['leave-balance'] })
      form.reset({
        leaveType: 'REGULAR',
        startDate: '',
        endDate: '',
        reason: '',
      })
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
        {balance && (
          <div
            className={cn(
              'rounded-lg border border-border bg-surface p-4',
              balance.remaining < 1 && 'border-red-200 bg-red-50',
            )}
          >
            <p className="text-sm text-text-secondary">Leave Balance</p>
            <p className="text-2xl font-bold text-primary">
              {balance.remaining}{' '}
              <span className="text-sm font-normal text-text-secondary">
                of {balance.totalAllowed} days remaining
              </span>
            </p>
          </div>
        )}

        <FormField
          control={form.control}
          name="leaveType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Leave Type</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select leave type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="REGULAR">Regular Leave</SelectItem>
                  <SelectItem value="SHORT_LEAVE">Short Leave</SelectItem>
                  <SelectItem value="EMERGENCY">Emergency Leave</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {leaveType === 'EMERGENCY' && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Emergency leave does not require 48 hours notice and will be
            immediately processed.
          </p>
        )}

        {leaveType === 'REGULAR' && (
          <p className="text-sm text-text-secondary">
            Regular leave must be requested at least 48 hours in advance.
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
                  <Input type="date" {...field} />
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
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        {leaveType === 'SHORT_LEAVE' && (
          <p className="text-sm text-text-secondary">
            Short leave is for a partial day absence. Maximum 2 short leaves per
            month.
          </p>
        )}

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
              excludeId={employeeId}
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
                <Textarea
                  placeholder="Describe the reason for your leave..."
                  rows={4}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          className="w-full bg-primary hover:bg-primary-dark"
          disabled={
            mutation.isPending ||
            (balance !== undefined &&
              typeof daysPreview === 'number' &&
              daysPreview > balance.remaining) ||
            (relieverId !== '' && shiftConflict)
          }
        >
          {mutation.isPending ? 'Submitting...' : 'Submit Application'}
        </Button>
      </form>
    </Form>
  )
}

function RelieverRequestsTab() {
  const [respondTarget, setRespondTarget] = useState<{
    request: IncomingRelieverRequest
    mode: 'accept' | 'decline'
  } | null>(null)

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['incoming-reliever'],
    queryFn: () => leaveApi.getIncomingRelieverRequests(),
  })

  return (
    <>
      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Requestor</TableHead>
              <TableHead>Leave Dates</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Requested At</TableHead>
              <TableHead>Actions</TableHead>
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
            ) : requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-text-secondary">
                  No pending reliever requests
                </TableCell>
              </TableRow>
            ) : (
              (requests as IncomingRelieverRequest[]).map((req) => (
                <TableRow key={req.id}>
                  <TableCell>
                    {req.requestedBy.fullName}
                  </TableCell>
                  <TableCell>
                    {format(new Date(req.leaveRecord.startDate), 'dd/MM/yyyy')} —{' '}
                    {format(new Date(req.leaveRecord.endDate), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>{req.leaveRecord.totalDays} days</TableCell>
                  <TableCell>
                    {format(new Date(req.requestedAt), 'dd/MM/yyyy HH:mm')}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() =>
                          setRespondTarget({ request: req, mode: 'accept' })
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          setRespondTarget({ request: req, mode: 'decline' })
                        }
                      >
                        Decline
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <RespondDialog
        request={respondTarget?.request ?? null}
        mode={respondTarget?.mode ?? 'accept'}
        open={!!respondTarget}
        onOpenChange={(v) => !v && setRespondTarget(null)}
      />
    </>
  )
}

export function MyLeavePage() {
  const { user } = useAuth()
  const employeeId = user?.employeeId ?? ''
  const year = new Date().getFullYear()
  const [tab, setTab] = useState('requests')
  const [relieverDialogLeave, setRelieverDialogLeave] =
    useState<LeaveRecord | null>(null)

  const { data: employee } = useQuery({
    queryKey: ['employee-self-leave', employeeId],
    queryFn: () => employeesApi.getOne(employeeId),
    enabled: !!employeeId,
  })

  const { data: balance, isLoading: loadingBalance } = useQuery({
    queryKey: ['leave-balance', employeeId, year],
    queryFn: () => leaveApi.getMyBalance(employeeId, year),
    enabled: !!employeeId,
  })

  const { data: incomingReliever = [] } = useQuery({
    queryKey: ['incoming-reliever'],
    queryFn: () => leaveApi.getIncomingRelieverRequests(),
    enabled: !!employeeId,
  })

  const { data: pendingRelieverLeaves = [] } = useQuery({
    queryKey: ['pending-reliever'],
    queryFn: () => leaveApi.getPendingReliever(),
    enabled: !!employeeId,
  })

  const pendingRelieverCount = incomingReliever.length
  const needsRelieverCount = pendingRelieverLeaves.length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">My Leave</h1>
        <p className="text-sm text-text-secondary">
          View balance, requests and apply for leave
        </p>
      </div>

      <Card className="border-border bg-gradient-to-r from-primary/5 to-accent/5 shadow-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
          {loadingBalance ? (
            <Skeleton className="h-16 w-48" />
          ) : (
            <>
              <div>
                <p className="text-sm text-text-secondary">Leave Balance · {year}</p>
                <p className="text-4xl font-bold text-primary">
                  {balance?.remaining ?? 0}
                  <span className="ml-2 text-lg font-normal text-text-secondary">
                    days remaining
                  </span>
                </p>
              </div>
              <div className="flex gap-6 text-sm">
                <div>
                  <p className="text-text-secondary">Allowed</p>
                  <p className="text-xl font-semibold">{balance?.totalAllowed ?? 0}</p>
                </div>
                <div>
                  <p className="text-text-secondary">Taken</p>
                  <p className="text-xl font-semibold">{balance?.taken ?? 0}</p>
                </div>
                <div>
                  <p className="text-text-secondary">Pending</p>
                  <p className="text-xl font-semibold text-amber-600">
                    {balance?.pending ?? 0}
                  </p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {needsRelieverCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Your leave requires a reliever selection. Please select a reliever
              to proceed.
              {needsRelieverCount > 1 &&
                ` (${needsRelieverCount} leave requests pending)`}
            </p>
          </div>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700"
            onClick={() =>
              setRelieverDialogLeave(pendingRelieverLeaves[0] as LeaveRecord)
            }
          >
            Select Reliever
          </Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requests">My Requests</TabsTrigger>
          <TabsTrigger value="apply">Apply Leave</TabsTrigger>
          <TabsTrigger value="reliever" className="relative">
            Reliever Requests
            {pendingRelieverCount > 0 && (
              <Badge className="ml-2 h-5 min-w-5 justify-center bg-red-600 px-1 text-[10px] text-white hover:bg-red-600">
                {pendingRelieverCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-4">
          <MyRequestsTab />
        </TabsContent>

        <TabsContent value="apply" className="mt-4">
          <ApplyLeaveTab onSuccess={() => setTab('requests')} />
        </TabsContent>

        <TabsContent value="reliever" className="mt-4">
          <RelieverRequestsTab />
        </TabsContent>
      </Tabs>

      <RelieverSelectDialog
        leave={relieverDialogLeave}
        open={!!relieverDialogLeave}
        onOpenChange={(open) => !open && setRelieverDialogLeave(null)}
        employeeId={employeeId}
        requesterShift={employee?.shift}
      />
    </div>
  )
}
