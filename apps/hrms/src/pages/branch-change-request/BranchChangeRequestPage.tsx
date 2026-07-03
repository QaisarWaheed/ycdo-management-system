import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { differenceInCalendarDays, format } from 'date-fns'
import { CheckCircle, Clock, MapPin, Plus, XCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { branchChangeRequestApi } from '@/api/endpoints/branchChangeRequest'
import { DateInput } from '@/components/common/DateInput'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
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
import type {
  BranchChangeRequest,
  BranchChangeRequestStatus,
  DistrictSummary,
} from '@/types'

const ALL = 'ALL'

function BranchChangeRequestStatusBadge({
  status,
}: {
  status: BranchChangeRequestStatus
}) {
  const styles: Record<BranchChangeRequestStatus, string> = {
    PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
    APPROVED: 'bg-green-100 text-green-800 border-green-200',
    REJECTED: 'bg-red-100 text-red-800 border-red-200',
    COMPLETED: 'bg-gray-100 text-gray-700 border-gray-200',
  }
  return (
    <Badge variant="outline" className={styles[status]}>
      {status}
    </Badge>
  )
}

function SummaryCards({
  requests,
  loading,
}: {
  requests: BranchChangeRequest[]
  loading: boolean
}) {
  const stats = useMemo(() => {
    const pending = requests.filter((r) => r.status === 'PENDING').length
    const approved = requests.filter((r) => r.status === 'APPROVED').length
    const rejected = requests.filter((r) => r.status === 'REJECTED').length
    return { total: requests.length, pending, approved, rejected }
  }, [requests])

  const cards = [
    { label: 'Total', value: stats.total, icon: MapPin, iconBg: 'bg-blue-100 text-blue-600' },
    { label: 'Pending', value: stats.pending, icon: Clock, iconBg: 'bg-amber-100 text-amber-600' },
    { label: 'Approved', value: stats.approved, icon: CheckCircle, iconBg: 'bg-green-100 text-green-600' },
    { label: 'Rejected', value: stats.rejected, icon: XCircle, iconBg: 'bg-red-100 text-red-600' },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(({ label, value, icon: Icon, iconBg }) => (
        <Card key={label} className="border-border shadow-sm">
          <CardContent className="flex items-center gap-4 p-6">
            <div className={`flex h-12 w-12 items-center justify-center rounded-full ${iconBg}`}>
              <Icon className="h-6 w-6" />
            </div>
            <div>
              {loading ? (
                <Skeleton className="mb-2 h-8 w-16" />
              ) : (
                <p className="text-3xl font-bold text-text-primary">{value}</p>
              )}
              <p className="text-sm text-text-secondary">{label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

const createSchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  district: z.string().min(1, 'District is required'),
  purpose: z.string().min(1, 'Purpose is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  notes: z.string().optional(),
})

type CreateFormValues = z.infer<typeof createSchema>

function NewRequestDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()

  const form = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      employeeId: '',
      district: '',
      purpose: '',
      startDate: '',
      endDate: '',
      notes: '',
    },
  })

  const startDate = form.watch('startDate')
  const endDate = form.watch('endDate')

  const durationPreview = useMemo(() => {
    if (!startDate || !endDate) return null
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (end < start) return null
    return differenceInCalendarDays(end, start) + 1
  }, [startDate, endDate])

  const mutation = useMutation({
    mutationFn: (values: CreateFormValues) =>
      branchChangeRequestApi.create({
        employeeId: values.employeeId,
        district: values.district,
        purpose: values.purpose,
        startDate: values.startDate,
        endDate: values.endDate,
        notes: values.notes || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Branch change request submitted' })
      queryClient.invalidateQueries({ queryKey: ['branch-change-request'] })
      queryClient.invalidateQueries({ queryKey: ['branch-change-district-summary'] })
      form.reset()
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to submit request',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Branch Change Request</DialogTitle>
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
                    onChange={field.onChange}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="district"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>District</FormLabel>
                  <FormControl>
                    <Input placeholder="Destination district" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="purpose"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Purpose</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Purpose of branch change..." {...field} />
                  </FormControl>
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

            {durationPreview !== null && (
              <p className="text-sm text-text-secondary">
                Duration: {durationPreview} day{durationPreview !== 1 ? 's' : ''}
              </p>
            )}

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
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
                {mutation.isPending ? 'Submitting...' : 'Submit Request'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function RequestsTab() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)

  const [employeeId, setEmployeeId] = useState('')
  const [district, setDistrict] = useState('')
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [confirmAction, setConfirmAction] = useState<{
    id: string
    action: 'APPROVED' | 'REJECTED'
  } | null>(null)

  const filters = useMemo(
    () => ({
      employeeId: employeeId || undefined,
      district: district || undefined,
      status: statusFilter !== ALL ? statusFilter : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
    [employeeId, district, statusFilter, startDate, endDate],
  )

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['branch-change-request', filters],
    queryFn: () => branchChangeRequestApi.getAll(filters),
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string
      status: BranchChangeRequestStatus
    }) =>
      branchChangeRequestApi.updateStatus(id, {
        status,
        approvedBy: user?.email ?? 'HR Admin',
      }),
    onSuccess: (_, vars) => {
      const titles: Record<string, string> = {
        APPROVED: 'Request approved',
        REJECTED: 'Request rejected',
        COMPLETED: 'Request marked completed',
      }
      toast({ title: titles[vars.status] ?? 'Status updated' })
      queryClient.invalidateQueries({ queryKey: ['branch-change-request'] })
      queryClient.invalidateQueries({ queryKey: ['branch-change-district-summary'] })
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
      <SummaryCards requests={requests as BranchChangeRequest[]} loading={isLoading} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <EmployeeSearchSelect
            label="Employee"
            value={employeeId}
            onChange={setEmployeeId}
            placeholder="Filter by employee..."
          />
        </div>

        <div className="space-y-1">
          <Label>District</Label>
          <Input
            className="w-[160px]"
            placeholder="District..."
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
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
              <SelectItem value="COMPLETED">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>From</Label>
          <DateInput
            className="w-[150px]"
            value={startDate}
            onChange={setStartDate}
          />
        </div>

        <div className="space-y-1">
          <Label>To</Label>
          <DateInput
            className="w-[150px]"
            value={endDate}
            onChange={setEndDate}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>District</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>End</TableHead>
              <TableHead>Duration</TableHead>
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
            ) : requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-text-secondary">
                  No branch change requests found
                </TableCell>
              </TableRow>
            ) : (
              (requests as BranchChangeRequest[]).map((req) => (
                <TableRow key={req.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">
                        {req.employee
                          ? `${req.employee.fullName}`
                          : '—'}
                      </p>
                      <p className="font-mono text-xs text-text-secondary">
                        {req.employee?.employeeCode ?? '—'}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>{req.district}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{req.purpose}</TableCell>
                  <TableCell>{format(new Date(req.startDate), 'dd/MM/yyyy')}</TableCell>
                  <TableCell>{format(new Date(req.endDate), 'dd/MM/yyyy')}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{req.duration}d</Badge>
                  </TableCell>
                  <TableCell>
                    <BranchChangeRequestStatusBadge status={req.status} />
                  </TableCell>
                  <TableCell>
                    {req.status === 'PENDING' && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                          onClick={() =>
                            setConfirmAction({ id: req.id, action: 'APPROVED' })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            setConfirmAction({ id: req.id, action: 'REJECTED' })
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                    {req.status === 'APPROVED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updateMutation.isPending}
                        onClick={() =>
                          updateMutation.mutate({ id: req.id, status: 'COMPLETED' })
                        }
                      >
                        Mark Completed
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
        open={!!confirmAction}
        title={
          confirmAction?.action === 'APPROVED'
            ? 'Approve Branch Change Request'
            : 'Reject Branch Change Request'
        }
        description={
          confirmAction?.action === 'APPROVED'
            ? 'Are you sure you want to approve this branch change request?'
            : 'Are you sure you want to reject this branch change request?'
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

function DistrictSummaryTab() {
  const { data: summary = [], isLoading } = useQuery({
    queryKey: ['branch-change-district-summary'],
    queryFn: () => branchChangeRequestApi.getDistrictSummary(),
  })

  const sorted = useMemo(
    () => [...(summary as DistrictSummary[])].sort((a, b) => b.total - a.total),
    [summary],
  )

  return (
    <div className="rounded-lg border border-border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>District</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Approved</TableHead>
            <TableHead>Pending</TableHead>
            <TableHead>Rejected</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            [...Array(5)].map((_, i) => (
              <TableRow key={i}>
                {[...Array(5)].map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="h-32 text-center text-text-secondary">
                No district data available
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((row) => (
              <TableRow key={row.district}>
                <TableCell className="font-medium">{row.district}</TableCell>
                <TableCell>{row.total}</TableCell>
                <TableCell>{row.approved}</TableCell>
                <TableCell>{row.pending}</TableCell>
                <TableCell>{row.rejected}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export function BranchChangeRequestPage() {
  const [newRequestOpen, setNewRequestOpen] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-text-primary">
          Branch Change Request Management
        </h1>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setNewRequestOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Request
        </Button>
      </div>

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="district">District Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-4">
          <RequestsTab />
        </TabsContent>

        <TabsContent value="district" className="mt-4">
          <DistrictSummaryTab />
        </TabsContent>
      </Tabs>

      <NewRequestDialog open={newRequestOpen} onOpenChange={setNewRequestOpen} />
    </div>
  )
}
