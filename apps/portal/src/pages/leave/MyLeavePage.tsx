import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { differenceInCalendarDays, format } from 'date-fns'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { leaveApi } from '@/api/endpoints/leave'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
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
import type { LeaveRecord } from '@/types'

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

const applySchema = z
  .object({
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
    reason: z
      .string()
      .min(1, 'Reason is required')
      .max(500, 'Reason must be 500 characters or less'),
  })
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true
      return new Date(data.endDate) >= new Date(data.startDate)
    },
    { message: 'End date must be on or after start date', path: ['endDate'] },
  )

type ApplyFormValues = z.infer<typeof applySchema>

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
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(6)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
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

function ApplyLeaveTab({ onSuccess }: { onSuccess: () => void }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const employeeId = user?.employeeId ?? ''

  const form = useForm<ApplyFormValues>({
    resolver: zodResolver(applySchema),
    defaultValues: { startDate: '', endDate: '', reason: '' },
  })

  const startDate = form.watch('startDate')
  const endDate = form.watch('endDate')
  const year = startDate
    ? new Date(startDate).getFullYear()
    : new Date().getFullYear()

  const { data: balance } = useQuery({
    queryKey: ['leave-balance', employeeId, year],
    queryFn: () => leaveApi.getMyBalance(employeeId, year),
    enabled: !!employeeId,
  })

  const daysPreview = useMemo(() => {
    if (!startDate || !endDate) return null
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (end < start) return null
    return differenceInCalendarDays(end, start) + 1
  }, [startDate, endDate])

  const mutation = useMutation({
    mutationFn: (values: ApplyFormValues) =>
      leaveApi.apply({ employeeId, ...values }),
    onSuccess: () => {
      toast({ title: 'Leave application submitted' })
      queryClient.invalidateQueries({ queryKey: ['leave'] })
      queryClient.invalidateQueries({ queryKey: ['leave-balance'] })
      form.reset()
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
            {balance.pending > 0 && (
              <p className="mt-1 text-xs text-amber-600">
                {balance.pending} day(s) pending approval
              </p>
            )}
          </div>
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
            {daysPreview} day{daysPreview !== 1 ? 's' : ''} requested
            {balance && daysPreview > balance.remaining && (
              <span className="ml-2 text-destructive">
                (exceeds remaining balance)
              </span>
            )}
          </p>
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
            (balance !== undefined && daysPreview !== null && daysPreview > balance.remaining)
          }
        >
          {mutation.isPending ? 'Submitting...' : 'Submit Application'}
        </Button>
      </form>
    </Form>
  )
}

export function MyLeavePage() {
  const { user } = useAuth()
  const employeeId = user?.employeeId ?? ''
  const year = new Date().getFullYear()
  const [tab, setTab] = useState('requests')

  const { data: balance, isLoading: loadingBalance } = useQuery({
    queryKey: ['leave-balance', employeeId, year],
    queryFn: () => leaveApi.getMyBalance(employeeId, year),
    enabled: !!employeeId,
  })

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
                <p className="text-sm text-text-secondary">
                  Leave Balance · {year}
                </p>
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
                  <p className="text-xl font-semibold">
                    {balance?.totalAllowed ?? 0}
                  </p>
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requests">My Requests</TabsTrigger>
          <TabsTrigger value="apply">Apply Leave</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-4">
          <MyRequestsTab />
        </TabsContent>

        <TabsContent value="apply" className="mt-4">
          <ApplyLeaveTab onSuccess={() => setTab('requests')} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
