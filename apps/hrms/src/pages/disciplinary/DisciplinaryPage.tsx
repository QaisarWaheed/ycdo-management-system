import { Fragment, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, format, isPast } from 'date-fns'
import { MoreHorizontal } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { disciplinaryApi } from '@/api/endpoints/disciplinary'
import { DateInput } from '@/components/common/DateInput'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
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
  DISCIPLINARY_STATUSES,
  DISCIPLINARY_TYPES,
  INQUIRY_OUTCOMES,
  type DisciplinaryAction,
  type Inquiry,
  type InquiryOutcome,
} from '@/types'

const ALL = 'ALL'

function typeBadgeClass(type: string) {
  const map: Record<string, string> = {
    WARNING: 'bg-amber-100 text-amber-800 border-amber-200',
    SHOW_CAUSE: 'bg-orange-100 text-orange-800 border-orange-200',
    FINE: 'bg-red-100 text-red-800 border-red-200',
    SUSPENSION: 'bg-red-200 text-red-900 border-red-300',
    TERMINATION: 'bg-gray-900 text-white border-gray-900',
  }
  return map[type] ?? 'bg-gray-100 text-gray-700'
}

function statusBadgeClass(status: string) {
  const map: Record<string, string> = {
    OPEN: 'bg-blue-100 text-blue-800 border-blue-200',
    UNDER_INQUIRY: 'bg-amber-100 text-amber-800 border-amber-200',
    RESOLVED: 'bg-green-100 text-green-800 border-green-200',
    DISMISSED: 'bg-gray-100 text-gray-700 border-gray-200',
  }
  return map[status] ?? ''
}

function outcomeBadgeClass(outcome: string | null | undefined) {
  if (!outcome) return 'bg-amber-100 text-amber-800 border-amber-200'
  const map: Record<string, string> = {
    REINSTATED: 'bg-green-100 text-green-800 border-green-200',
    TERMINATED: 'bg-red-100 text-red-800 border-red-200',
    REJOINED: 'bg-blue-100 text-blue-800 border-blue-200',
    DISMISSED: 'bg-gray-100 text-gray-700 border-gray-200',
  }
  return map[outcome] ?? ''
}

const createSchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  type: z.enum(['WARNING', 'SHOW_CAUSE', 'FINE', 'SUSPENSION', 'TERMINATION']),
  reason: z.string().min(1, 'Reason is required'),
  issuedAt: z.string().min(1, 'Date is required'),
})

type CreateFormValues = z.infer<typeof createSchema>

function NewActionDialog({
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
      type: 'WARNING',
      reason: '',
      issuedAt: format(new Date(), 'yyyy-MM-dd'),
    },
  })

  const mutation = useMutation({
    mutationFn: (values: CreateFormValues) => disciplinaryApi.create(values),
    onSuccess: (_, vars) => {
      toast({
        title: 'Disciplinary action created',
        description: `${vars.type.replace(/_/g, ' ')} letter generated automatically`,
      })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
      form.reset({
        employeeId: '',
        type: 'WARNING',
        reason: '',
        issuedAt: format(new Date(), 'yyyy-MM-dd'),
      })
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to create action',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Disciplinary Action</DialogTitle>
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
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {DISCIPLINARY_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t.replace(/_/g, ' ')}
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
            <FormField
              control={form.control}
              name="issuedAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Issued Date</FormLabel>
                  <FormControl>
                    <DateInput
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={mutation.isPending}>
                {mutation.isPending ? 'Creating...' : 'Create Action'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function StartInquiryDialog({
  actionId,
  open,
  onOpenChange,
  onSuccess,
}: {
  actionId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const queryClient = useQueryClient()
  const [deadlineDays, setDeadlineDays] = useState(3)
  const [notes, setNotes] = useState('')

  const deadlineDate = addDays(new Date(), deadlineDays)

  const mutation = useMutation({
    mutationFn: () =>
      disciplinaryApi.startInquiry({
        disciplinaryActionId: actionId,
        deadlineDays,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Inquiry started', description: 'Inquiry letter generated' })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
      setNotes('')
      setDeadlineDays(3)
      onOpenChange(false)
      onSuccess()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to start inquiry',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start Inquiry</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Deadline Days</Label>
            <Input
              type="number"
              min={1}
              max={30}
              value={deadlineDays}
              onChange={(e) =>
                setDeadlineDays(Math.min(30, Math.max(1, Number(e.target.value))))
              }
            />
          </div>
          <p className="text-sm text-text-secondary">
            Inquiry deadline:{' '}
            <span className="font-medium">
              {format(deadlineDate, 'dd/MM/yyyy')}
            </span>
          </p>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={!actionId || mutation.isPending}
            onClick={() => actionId && mutation.mutate()}
          >
            {mutation.isPending ? 'Starting...' : 'Start Inquiry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const RESOLVE_FIELDS: Record<
  InquiryOutcome,
  { key: string; label: string; type?: 'textarea' }[]
> = {
  REINSTATED: [
    { key: 'reinstatementDate', label: 'Reinstatement Date' },
    { key: 'reinstatedDesignation', label: 'Reinstated Designation' },
  ],
  TERMINATED: [
    { key: 'terminationDate', label: 'Termination Date' },
    { key: 'terminationReason', label: 'Termination Reason', type: 'textarea' },
    { key: 'settlementDetails', label: 'Settlement Details', type: 'textarea' },
  ],
  REJOINED: [
    { key: 'rejoiningDate', label: 'Rejoining Date' },
    { key: 'rejoiningDesignation', label: 'Rejoining Designation' },
  ],
  DISMISSED: [],
}

function ResolveInquiryDialog({
  inquiry,
  open,
  onOpenChange,
}: {
  inquiry: Inquiry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [outcome, setOutcome] = useState<InquiryOutcome>('REINSTATED')
  const [notes, setNotes] = useState('')
  const [extraFields, setExtraFields] = useState<Record<string, string>>({})
  const [confirmDismissed, setConfirmDismissed] = useState(false)

  const mutation = useMutation({
    mutationFn: () =>
      disciplinaryApi.resolveInquiry({
        inquiryId: inquiry!.id,
        outcome,
        notes: notes || undefined,
        extraLetterFields: Object.fromEntries(
          Object.entries(extraFields).filter(([, v]) => v !== ''),
        ),
      }),
    onSuccess: () => {
      toast({
        title: 'Inquiry resolved',
        description: `Outcome: ${outcome.replace(/_/g, ' ')} — letter generated`,
      })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
      setNotes('')
      setExtraFields({})
      setConfirmDismissed(false)
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to resolve inquiry',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const fields = RESOLVE_FIELDS[outcome]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resolve Inquiry</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Outcome</Label>
            <Select
              value={outcome}
              onValueChange={(v) => {
                setOutcome(v as InquiryOutcome)
                setExtraFields({})
                setConfirmDismissed(false)
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INQUIRY_OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {outcome === 'TERMINATED' && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              This will permanently terminate the employee.
            </p>
          )}
          {outcome === 'REINSTATED' && (
            <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
              Employee will be reinstated to ACTIVE status.
            </p>
          )}
          {outcome === 'DISMISSED' && (
            <>
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                This will permanently dismiss the employee. Dismissed employees
                cannot change status and are barred from rejoining.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={confirmDismissed}
                  onChange={(e) => setConfirmDismissed(e.target.checked)}
                />
                <span>
                  I understand this action is permanent and will dismiss the
                  employee from the organization.
                </span>
              </label>
            </>
          )}

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {fields.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label>{field.label}</Label>
              {field.type === 'textarea' ? (
                <Textarea
                  value={extraFields[field.key] ?? ''}
                  onChange={(e) =>
                    setExtraFields((f) => ({ ...f, [field.key]: e.target.value }))
                  }
                />
              ) : (
                <Input
                  value={extraFields[field.key] ?? ''}
                  onChange={(e) =>
                    setExtraFields((f) => ({ ...f, [field.key]: e.target.value }))
                  }
                />
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={
              mutation.isPending || (outcome === 'DISMISSED' && !confirmDismissed)
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Resolving...' : 'Resolve Inquiry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ActionsTab({
  onStartInquiry,
  onSwitchToInquiries,
}: {
  onStartInquiry: (actionId: string) => void
  onSwitchToInquiries: () => void
}) {
  const [employeeId, setEmployeeId] = useState('')
  const [typeFilter, setTypeFilter] = useState(ALL)
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filters = useMemo(
    () => ({
      employeeId: employeeId || undefined,
      type: typeFilter !== ALL ? typeFilter : undefined,
      status: statusFilter !== ALL ? statusFilter : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
    [employeeId, typeFilter, statusFilter, startDate, endDate],
  )

  const { data: actions = [], isLoading } = useQuery({
    queryKey: ['disciplinary', filters],
    queryFn: () => disciplinaryApi.getAll(filters),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <EmployeeSearchSelect
            label="Employee"
            value={employeeId}
            onChange={setEmployeeId}
            placeholder="Filter by employee..."
          />
        </div>
        <div className="space-y-1">
          <Label>Type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Types</SelectItem>
              {DISCIPLINARY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Statuses</SelectItem>
              {DISCIPLINARY_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>From</Label>
          <DateInput className="w-[140px]" value={startDate} onChange={setStartDate} />
        </div>
        <div className="space-y-1">
          <Label>To</Label>
          <DateInput className="w-[140px]" value={endDate} onChange={setEndDate} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Issued Date</TableHead>
              <TableHead>Inquiry</TableHead>
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
            ) : actions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-text-secondary">
                  No disciplinary actions found
                </TableCell>
              </TableRow>
            ) : (
              (actions as DisciplinaryAction[]).map((action) => (
                <Fragment key={action.id}>
                  <TableRow>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {action.employee
                            ? `${action.employee.fullName}`
                            : '—'}
                        </p>
                        <p className="font-mono text-xs text-text-secondary">
                          {action.employee?.employeeCode ?? '—'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={typeBadgeClass(action.type)}>
                        {action.type.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className="max-w-[200px] truncate"
                      title={action.reason}
                    >
                      {action.reason.length > 60
                        ? `${action.reason.slice(0, 60)}…`
                        : action.reason}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusBadgeClass(action.status)}>
                        {action.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {format(new Date(action.issuedAt), 'dd/MM/yyyy')}
                    </TableCell>
                    <TableCell>
                      {action.inquiry ? (
                        <Button
                          variant="link"
                          className="h-auto p-0"
                          onClick={onSwitchToInquiries}
                        >
                          View
                        </Button>
                      ) : action.status === 'OPEN' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onStartInquiry(action.id)}
                        >
                          Start Inquiry
                        </Button>
                      ) : (
                        '—'
                      )}
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
                            onClick={() =>
                              setExpandedId(expandedId === action.id ? null : action.id)
                            }
                          >
                            View Details
                          </DropdownMenuItem>
                          {action.status === 'OPEN' && !action.inquiry && (
                            <DropdownMenuItem
                              onClick={() => onStartInquiry(action.id)}
                            >
                              Start Inquiry
                            </DropdownMenuItem>
                          )}
                          {action.employeeId && (
                            <DropdownMenuItem asChild>
                              <a href={`/letters?employeeId=${action.employeeId}`}>
                                View Letter
                              </a>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  {expandedId === action.id && (
                    <TableRow key={`${action.id}-detail`}>
                      <TableCell colSpan={7} className="bg-surface">
                        <p className="text-sm">
                          <span className="font-medium">Full reason: </span>
                          {action.reason}
                        </p>
                        {action.inquiry && (
                          <p className="mt-2 text-sm text-text-secondary">
                            Inquiry deadline:{' '}
                            {format(new Date(action.inquiry.deadlineAt), 'dd/MM/yyyy')}
                            {action.inquiry.outcome &&
                              ` · Outcome: ${action.inquiry.outcome}`}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function InquiriesTab({
  onResolve,
}: {
  onResolve: (inquiry: Inquiry) => void
}) {
  const [employeeId, setEmployeeId] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState(ALL)

  const { data: actions = [], isLoading } = useQuery({
    queryKey: ['disciplinary', 'inquiries', employeeId],
    queryFn: () =>
      disciplinaryApi.getAll({
        employeeId: employeeId || undefined,
      }),
  })

  const inquiries = useMemo(() => {
    type InquiryRow = Inquiry & { action: DisciplinaryAction }
    let list: InquiryRow[] = (actions as DisciplinaryAction[])
      .filter((a) => a.inquiry)
      .map((a) => ({
        ...a.inquiry!,
        action: a,
      }))

    if (outcomeFilter === 'PENDING') {
      list = list.filter((i) => !i.outcome)
    } else if (outcomeFilter !== ALL) {
      list = list.filter((i) => i.outcome === outcomeFilter)
    }

    return list
  }, [actions, outcomeFilter])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <EmployeeSearchSelect
            label="Employee"
            value={employeeId}
            onChange={setEmployeeId}
            placeholder="Filter by employee..."
          />
        </div>
        <div className="space-y-1">
          <Label>Outcome</Label>
          <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              {INQUIRY_OUTCOMES.map((o) => (
                <SelectItem key={o} value={o}>
                  {o.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Action Type</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Outcome</TableHead>
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
            ) : inquiries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-text-secondary">
                  No inquiries found
                </TableCell>
              </TableRow>
            ) : (
              inquiries.map((inquiry) => {
                const action = inquiry.action
                const overdue =
                  !inquiry.outcome && isPast(new Date(inquiry.deadlineAt))
                return (
                  <TableRow key={inquiry.id}>
                    <TableCell>
                      {action.employee
                        ? `${action.employee.fullName}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={typeBadgeClass(action.type)}>
                        {action.type.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate" title={action.reason}>
                      {action.reason}
                    </TableCell>
                    <TableCell>
                      {format(new Date(inquiry.startedAt), 'dd/MM/yyyy')}
                    </TableCell>
                    <TableCell
                      className={cn(overdue && 'font-medium text-red-600')}
                    >
                      {format(new Date(inquiry.deadlineAt), 'dd/MM/yyyy')}
                    </TableCell>
                    <TableCell>
                      {inquiry.outcome ? 'Resolved' : 'Open'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={outcomeBadgeClass(inquiry.outcome)}
                      >
                        {inquiry.outcome
                          ? inquiry.outcome.replace(/_/g, ' ')
                          : 'Awaiting Resolution'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {!inquiry.outcome && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onResolve(inquiry)}
                        >
                          Resolve Inquiry
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export function DisciplinaryPage() {
  const [tab, setTab] = useState('actions')
  const [newActionOpen, setNewActionOpen] = useState(false)
  const [startInquiryId, setStartInquiryId] = useState<string | null>(null)
  const [resolveInquiry, setResolveInquiry] = useState<Inquiry | null>(null)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-text-primary">
          Disciplinary Management
        </h1>
        <Button variant="destructive" onClick={() => setNewActionOpen(true)}>
          New Action
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="inquiries">Inquiries</TabsTrigger>
        </TabsList>

        <TabsContent value="actions" className="mt-4">
          <ActionsTab
            onStartInquiry={setStartInquiryId}
            onSwitchToInquiries={() => setTab('inquiries')}
          />
        </TabsContent>

        <TabsContent value="inquiries" className="mt-4">
          <InquiriesTab onResolve={setResolveInquiry} />
        </TabsContent>
      </Tabs>

      <NewActionDialog open={newActionOpen} onOpenChange={setNewActionOpen} />

      <StartInquiryDialog
        actionId={startInquiryId}
        open={!!startInquiryId}
        onOpenChange={(v) => !v && setStartInquiryId(null)}
        onSuccess={() => {
          setStartInquiryId(null)
          setTab('inquiries')
        }}
      />

      <ResolveInquiryDialog
        inquiry={resolveInquiry}
        open={!!resolveInquiry}
        onOpenChange={(v) => !v && setResolveInquiry(null)}
      />
    </div>
  )
}
