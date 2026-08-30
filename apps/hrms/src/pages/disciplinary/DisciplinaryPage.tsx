import { Fragment, useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, format } from 'date-fns'
import { MoreHorizontal } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { disciplinaryApi } from '@/api/endpoints/disciplinary'
import { canStartLegacyInquiry, isOpenEnquiryAction, isOrphanEnquiryAction, officerNameFromReason } from '@/lib/disciplinaryInquiryUi'
import { branchesApi } from '@/api/endpoints/branches'
import { TablePagination } from '@/components/common/TablePagination'
import { TableRecordCount } from '@/components/common/TableRecordCount'
import { DateInput } from '@/components/common/DateInput'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { PrepareSuspensionDialog } from '@/components/disciplinary/PrepareSuspensionDialog'
import { PendingInquiryDecisionsCard } from '@/components/disciplinary/PendingInquiryDecisionsCard'
import { PendingInquiryOpenApprovalsCard } from '@/components/disciplinary/PendingInquiryOpenApprovalsCard'
import { CloseInquiryDialog } from '@/components/disciplinary/CloseInquiryDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useAuth } from '@/hooks/useAuth'
import { usePagination } from '@/hooks/usePagination'
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

function inquiryDeadlineWarning(
  inquiry: Pick<Inquiry, 'deadlineAt' | 'outcome' | 'closedAt' | 'officiallyOpenedAt'>,
  now = new Date(),
): 'Overdue' | 'Due soon' | null {
  if (inquiry.closedAt || inquiry.outcome || !inquiry.officiallyOpenedAt) return null
  const deadline = new Date(inquiry.deadlineAt).getTime()
  if (Number.isNaN(deadline)) return null
  if (deadline <= now.getTime()) return 'Overdue'
  if (deadline <= now.getTime() + 24 * 60 * 60 * 1000) return 'Due soon'
  return null
}

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

function personName(user?: {
  email?: string
  employee?: { fullName: string } | null
} | null) {
  if (!user) return '—'
  return user.employee?.fullName || user.email || '—'
}

function inquiryOfficerLabel(inquiry: Inquiry) {
  const named = inquiry.inquiryOfficerName?.trim()
  if (named) return named
  return personName(inquiry.inquiryOfficer)
}

function placeholderInquiry(action: DisciplinaryAction): Inquiry {
  const started = action.issuedAt
  const startDate = new Date(started)
  const deadline = Number.isNaN(startDate.getTime())
    ? new Date()
    : addDays(startDate, 7)
  return {
    id: '',
    disciplinaryActionId: action.id,
    startedAt: started,
    deadlineAt: deadline.toISOString(),
    inquiryOfficerName: officerNameFromReason(action.reason),
    outcome: null,
    closedAt: null,
  }
}

const VERDICT_LABELS: Record<InquiryOutcome, string> = {
  REINSTATED: 'Join again (reinstate)',
  REJOINED: 'Rejoin',
  REST: 'Send to rest',
  DISMISSED: 'Dismiss',
  TERMINATED: 'Terminate',
}

function inquiryIsOpen(inquiry: Pick<Inquiry, 'outcome' | 'closedAt' | 'finalDecisionStatus'>) {
  return (
    !inquiry.outcome &&
    !inquiry.closedAt &&
    inquiry.finalDecisionStatus !== 'APPLIED'
  )
}

function inquiryWorkflowLabel(inquiry: Inquiry) {
  if (inquiry.finalDecisionStatus === 'APPLIED' && inquiry.outcome) {
    return inquiry.outcome.replace(/_/g, ' ')
  }
  if (inquiry.outcome) {
    return inquiry.outcome.replace(/_/g, ' ')
  }
  if (inquiry.openApprovalStatus === 'PENDING_APPROVAL' && !inquiry.officiallyOpenedAt) {
    return 'Awaiting opening approval'
  }
  if (inquiry.openApprovalStatus === 'REJECTED' && !inquiry.officiallyOpenedAt) {
    return 'Opening rejected'
  }
  if (inquiry.finalDecisionStatus === 'PENDING_APPROVAL') {
    return 'Final decision pending approval'
  }
  if (inquiry.finalDecisionStatus === 'REJECTED') {
    return 'Final decision rejected — correct and close again'
  }
  if (inquiry.officiallyOpenedAt && !inquiry.finding) {
    return 'Open inquiry'
  }
  if (inquiry.finding === 'NOT_GUILTY') {
    return 'NOT GUILTY — choose duty branch, then reinstate'
  }
  if (inquiry.finding === 'GUILTY') {
    return 'GUILTY — select final action'
  }
  return 'Awaiting finding'
}

function formatWhen(value?: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : format(parsed, 'dd/MM/yyyy HH:mm')
}

function InquiryFinalState({
  inquiry,
  employeeStatus,
  employeeId,
  canRecoverLetters,
}: {
  inquiry: Inquiry
  employeeStatus?: string
  employeeId?: string
  canRecoverLetters: boolean
}) {
  const queryClient = useQueryClient()
  const applied = inquiry.finalDecisionStatus === 'APPLIED' || !!inquiry.outcome
  const rejected = inquiry.finalDecisionStatus === 'REJECTED' && !applied
  const transferRequired =
    inquiry.finding === 'NOT_GUILTY' ||
    inquiry.finalAction === 'FINE_AND_REINSTATE'
  const fineLabel =
    inquiry.finalAction !== 'FINE_AND_REINSTATE'
      ? '—'
      : inquiry.appliedFineDeductionId
        ? `Applied (${inquiry.appliedFineDeductionId})`
        : applied
          ? 'Blocked / not posted'
          : 'Not applied yet'
  const missingLetters = (inquiry.finalLetters ?? []).filter(
    (letter) => letter.status === 'MISSING',
  )

  const recoverMutation = useMutation({
    mutationFn: () => disciplinaryApi.generateMissingFinalLetters(inquiry.id),
    onSuccess: () => {
      toast({
        title: 'Missing final letters generated',
        description: 'Drafts were created. Review and issue them from Letters.',
      })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Could not generate missing letters',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? ''),
        variant: 'destructive',
      })
    },
  })

  return (
    <div className="space-y-0.5 text-xs text-text-secondary">
      <p>Inquiry officer: {personName(inquiry.inquiryOfficer)}</p>
      <p>
        Officer designation:{' '}
        {inquiry.inquiryOfficer?.employee?.currentDesignation ?? '—'}
      </p>
      <p>Finding: {inquiry.finding?.replace(/_/g, ' ') ?? '—'}</p>
      <p>Finding recorded by: {personName(inquiry.findingRecordedBy)}</p>
      <p>Finding recorded at: {formatWhen(inquiry.findingRecordedAt)}</p>
      <p>
        Final action:{' '}
        {inquiry.finding === 'NOT_GUILTY'
          ? 'Transfer + reinstate'
          : inquiry.finalAction?.replace(/_/g, ' ') ?? '—'}
      </p>
      <p>
        Final decision:{' '}
        {inquiry.finalDecisionStatus?.replace(/_/g, ' ') ?? '—'}
      </p>
      <p>Selected approver: {personName(inquiry.selectedFinalApprover)}</p>
      {(inquiry.finalDecisionNote || inquiry.finalDecidedBy) && (
        <p>
          {rejected ? 'Rejection' : 'Decision note'}:{' '}
          {personName(inquiry.finalDecidedBy)}
          {inquiry.finalDecidedAt ? ` · ${formatWhen(inquiry.finalDecidedAt)}` : ''}
          {inquiry.finalDecisionNote ? ` — ${inquiry.finalDecisionNote}` : ''}
        </p>
      )}
      <p>Transfer required: {transferRequired ? 'Yes' : 'No'}</p>
      <p>Destination branch: {inquiry.destinationBranch?.name ?? '—'}</p>
      <p>
        Fine amount:{' '}
        {inquiry.fineAmount != null && inquiry.fineAmount !== ''
          ? String(inquiry.fineAmount)
          : '—'}
      </p>
      <p>Fine: {fineLabel}</p>
      <p>Recommendation: {inquiry.closeRecommendation ?? '—'}</p>
      <p>Final outcome: {inquiry.outcome?.replace(/_/g, ' ') ?? '—'}</p>
      <p>Closed at: {formatWhen(inquiry.closedAt)}</p>
      <p>Employee status: {employeeStatus?.replace(/_/g, ' ') ?? '—'}</p>
      {applied && (
        <div className="space-y-1 pt-1">
          <p className="font-medium text-text-primary">Required final letters</p>
          {(inquiry.finalLetters ?? []).length === 0 ? (
            <p>None required</p>
          ) : (
            inquiry.finalLetters!.map((letter) => (
              <div key={letter.inquiryLetterKind} className="flex flex-wrap items-center gap-2">
                <span>
                  {letter.inquiryLetterKind.replace(/_/g, ' ')}: {letter.status}
                  {letter.letterNo ? ` (${letter.letterNo})` : ''}
                </span>
                {letter.status === 'DRAFT' && employeeId && (
                  <a
                    className="text-primary underline"
                    href={`/letters?employeeId=${employeeId}`}
                  >
                    Review in Letters
                  </a>
                )}
                {letter.status === 'SENT' && (
                  <span>Issued — read-only</span>
                )}
              </div>
            ))
          )}
          {missingLetters.length > 0 && canRecoverLetters && (
            <Button
              size="sm"
              variant="outline"
              disabled={recoverMutation.isPending}
              onClick={() => recoverMutation.mutate()}
            >
              Generate Missing Final Letter(s)
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function outcomeBadgeClass(outcome: string | null | undefined) {
  if (!outcome) return 'bg-amber-100 text-amber-800 border-amber-200'
  const map: Record<string, string> = {
    REINSTATED: 'bg-green-100 text-green-800 border-green-200',
    TERMINATED: 'bg-red-100 text-red-800 border-red-200',
    REJOINED: 'bg-blue-100 text-blue-800 border-blue-200',
    DISMISSED: 'bg-gray-100 text-gray-700 border-gray-200',
    REST: 'bg-slate-100 text-slate-700 border-slate-200',
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
                      name={field.name}
                      ref={field.ref}
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
  const [decision, setDecision] = useState('')
  const [duration, setDuration] = useState('')

  useEffect(() => {
    if (!open) return
    setOutcome('REINSTATED')
    setDecision('')
    setDuration('')
  }, [open, inquiry?.id])

  const mutation = useMutation({
    mutationFn: () =>
      disciplinaryApi.resolveInquiry({
        inquiryId: inquiry!.id,
        outcome,
        decision: decision.trim() || undefined,
        duration: duration.trim() || undefined,
      }),
    onSuccess: () => {
      toast({
        title: 'Inquiry closed',
        description: `Outcome: ${VERDICT_LABELS[outcome]}`,
      })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
      setDecision('')
      setDuration('')
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to close inquiry',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close Inquiry</DialogTitle>
          <DialogDescription>
            Record the outcome, decision, and duration for this inquiry.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Outcome of inquiry</Label>
            <Select
              value={outcome}
              onValueChange={(v) => setOutcome(v as InquiryOutcome)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INQUIRY_OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {VERDICT_LABELS[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Decision</Label>
            <Textarea
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              placeholder="Write the decision on this inquiry…"
            />
          </div>
          <div className="space-y-2">
            <Label>Duration</Label>
            <Input
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="e.g. 7 days"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={mutation.isPending || !inquiry?.id}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Closing...' : 'Close Inquiry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function canPrepareSuspension(action: DisciplinaryAction) {
  if (action.type !== 'SUSPENSION') return false
  if (action.status !== 'OPEN' && action.status !== 'UNDER_INQUIRY') return false
  const status = action.suspensionRequest?.status
  return !status || status === 'DRAFT' || status === 'REJECTED'
}

function ActionsTab({
  onStartInquiry,
  onSwitchToInquiries,
  onPrepareSuspension,
  onCloseInquiry,
  canPrepare,
  canClose,
}: {
  onStartInquiry: (actionId: string) => void
  onSwitchToInquiries: () => void
  onPrepareSuspension: (action: DisciplinaryAction) => void
  onCloseInquiry: (action: DisciplinaryAction) => void
  canPrepare: boolean
  canClose: boolean
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

  const actionList = actions as DisciplinaryAction[]

  const { page, setPage, totalPages, paginated, total } = usePagination(
    actionList,
    [filters],
  )

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

      <TableRecordCount count={total} label="disciplinary action" />

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
              <TableHead>Actions</TableHead>
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
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-text-secondary">
                  No disciplinary actions found
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((action) => (
                <Fragment key={action.id}>
                  <TableRow>
                    <TableCell>
                      <div>
                        <EmployeeNameLink
                          employee={action.employee}
                          employeeId={action.employeeId}
                        />
                        <p className="font-mono text-xs text-text-secondary">
                          {action.employee?.employeeCode ?? '—'}
                        </p>
                        {action.employee?.status && (
                          <p className="text-xs text-text-secondary">
                            {action.employee.status.replace(/_/g, ' ')}
                          </p>
                        )}
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
                      ) : canStartLegacyInquiry(action) ? (
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
                      <div className="flex items-center gap-2">
                        {canClose && isOpenEnquiryAction(action) && (
                          <Button
                            size="sm"
                            onClick={() => onCloseInquiry(action)}
                          >
                            Close Inquiry
                          </Button>
                        )}
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
                          {canStartLegacyInquiry(action) && (
                            <DropdownMenuItem
                              onClick={() => onStartInquiry(action.id)}
                            >
                              Start Inquiry
                            </DropdownMenuItem>
                          )}
                          {canClose && isOpenEnquiryAction(action) && (
                            <DropdownMenuItem
                              onClick={() => onCloseInquiry(action)}
                            >
                              Close Inquiry
                            </DropdownMenuItem>
                          )}
                          {canPrepare && canPrepareSuspension(action) && (
                            <DropdownMenuItem
                              onClick={() => onPrepareSuspension(action)}
                            >
                              {action.suspensionRequest?.status === 'REJECTED'
                                ? 'Revise Suspension'
                                : 'Prepare Suspension'}
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
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === action.id && (
                    <TableRow key={`${action.id}-detail`}>
                      <TableCell colSpan={7} className="bg-surface">
                        <p className="text-sm">
                          <span className="font-medium">Full reason: </span>
                          {action.reason}
                        </p>
                        {action.suspensionRequest && (
                          <p className="mt-2 text-sm">
                            <span className="font-medium">
                              Suspension request:{' '}
                            </span>
                            {action.suspensionRequest.status ===
                            'PENDING_APPROVAL'
                              ? `Pending approval — ${
                                  action.suspensionRequest.selectedApprover
                                    ?.employee?.fullName ??
                                  action.suspensionRequest.selectedApprover
                                    ?.email ??
                                  'selected approver'
                                }`
                              : action.suspensionRequest.status === 'APPROVED'
                                ? 'Approved — issue the suspension from Letters to suspend the employee'
                                : action.suspensionRequest.status === 'REJECTED'
                                  ? `Rejected${
                                      action.suspensionRequest.decisionNote
                                        ? ` — ${action.suspensionRequest.decisionNote}`
                                        : ''
                                    }`
                                  : action.suspensionRequest.status === 'ISSUED'
                                    ? 'Issued — employee suspended, inquiry open'
                                    : action.suspensionRequest.status ===
                                        'COMPLETED'
                                      ? 'Completed — inquiry resolved'
                                      : action.suspensionRequest.status.replace(
                                          /_/g,
                                          ' ',
                                        )}
                          </p>
                        )}
                        {action.inquiry && (
                          <p className="mt-2 text-sm text-text-secondary">
                            Inquiry deadline:{' '}
                            {format(new Date(action.inquiry.deadlineAt), 'dd/MM/yyyy')}
                            {(() => {
                              const warning = inquiryDeadlineWarning(action.inquiry)
                              return warning ? ` · ${warning}` : ''
                            })()}
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

        <TablePagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPageChange={setPage}
        />
      </div>
    </div>
  )
}

function InquiriesTab({
  onCloseInquiry,
}: {
  onCloseInquiry: (action: DisciplinaryAction) => void
}) {
  const { user, hasRole } = useAuth()
  const canPrepare = hasRole(['SUPER_ADMIN', 'HR_MANAGER', 'ADMIN_MANAGER'])
  const canClose = hasRole(['SUPER_ADMIN', 'HR_MANAGER', 'ADMIN_MANAGER'])
  const [findingInquiry, setFindingInquiry] = useState<Inquiry | null>(null)
  const [decisionInquiry, setDecisionInquiry] = useState<Inquiry | null>(null)
  const [detailInquiry, setDetailInquiry] = useState<
    (Inquiry & { action: DisciplinaryAction }) | null
  >(null)
  const [closeInquiry, setCloseInquiry] = useState<Inquiry | null>(null)
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
      .filter((a) => a.inquiry || isOrphanEnquiryAction(a))
      .map((a) => ({
        ...(a.inquiry ?? placeholderInquiry(a)),
        action: a,
      }))

    if (outcomeFilter === 'PENDING') {
      list = list.filter((i) => !i.outcome)
    } else if (outcomeFilter !== ALL) {
      list = list.filter((i) => i.outcome === outcomeFilter)
    }

    return list
  }, [actions, outcomeFilter])

  const { page, setPage, totalPages, paginated, total } = usePagination(
    inquiries,
    [employeeId, outcomeFilter],
  )

  return (
    <div className="space-y-4">
      <PendingInquiryOpenApprovalsCard />
      <PendingInquiryDecisionsCard />
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

      <TableRecordCount count={total} label="inquiry" />

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Officer</TableHead>
              <TableHead>Action Type</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Start enquiry</TableHead>
              <TableHead>End enquiry</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(9)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-text-secondary">
                  No inquiries found
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((inquiry) => {
                const action = inquiry.action
                const warning = inquiryDeadlineWarning(inquiry)
                const officiallyOpen = !!inquiry.officiallyOpenedAt
                return (
                  <TableRow
                    key={inquiry.id}
                    className={cn(warning === 'Overdue' && 'bg-red-50')}
                  >
                    <TableCell>
                      <EmployeeNameLink
                        employee={action.employee}
                        employeeId={action.employeeId}
                      />
                    </TableCell>
                    <TableCell>{inquiryOfficerLabel(inquiry)}</TableCell>
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
                      className={cn(
                        warning === 'Overdue' && 'font-medium text-red-600',
                        warning === 'Due soon' && 'font-medium text-amber-700',
                      )}
                    >
                      <div className="flex flex-col gap-1">
                        <span>
                          {format(new Date(inquiry.deadlineAt), 'dd/MM/yyyy')}
                        </span>
                        {warning && (
                          <Badge
                            variant="outline"
                            className={
                              warning === 'Overdue'
                                ? 'w-fit border-red-200 bg-red-50 text-red-700'
                                : 'w-fit border-amber-200 bg-amber-50 text-amber-800'
                            }
                          >
                            {warning}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2">
                        <span className="text-sm">
                          {inquiry.outcome
                            ? 'Closed'
                            : inquiry.officiallyOpenedAt
                              ? 'Open inquiry'
                              : 'Awaiting opening approval'}
                        </span>
                        <InquiryFinalState
                          inquiry={inquiry}
                          employeeStatus={action.employee?.status}
                          employeeId={action.employeeId}
                          canRecoverLetters={canPrepare}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={outcomeBadgeClass(inquiry.outcome)}
                      >
                        {inquiryWorkflowLabel(inquiry)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDetailInquiry(inquiry)}
                        >
                          View Details
                        </Button>
                        {canClose && inquiryIsOpen(inquiry) && (
                          <Button
                            size="sm"
                            onClick={() => onCloseInquiry(inquiry.action)}
                          >
                            Close Inquiry
                          </Button>
                        )}
                        {action.type === 'SUSPENSION' &&
                          officiallyOpen &&
                          !inquiry.outcome &&
                          inquiry.finalDecisionStatus !== 'PENDING_APPROVAL' &&
                          inquiry.finalDecisionStatus !== 'APPLIED' &&
                          canPrepare && (
                            <Button
                              size="sm"
                              onClick={() => setCloseInquiry(inquiry)}
                            >
                              Close inquiry
                            </Button>
                          )}
                        {action.type === 'SUSPENSION' &&
                          !inquiry.finding &&
                          !inquiry.outcome &&
                          officiallyOpen &&
                          inquiry.finalDecisionStatus !== 'APPLIED' &&
                          user?.id === inquiry.inquiryOfficerUserId && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setFindingInquiry(inquiry)}
                            >
                              Record finding
                            </Button>
                          )}
                        {action.type === 'SUSPENSION' &&
                          !!inquiry.finding &&
                          inquiryIsOpen(inquiry) &&
                          inquiry.finalDecisionStatus !== 'PENDING_APPROVAL' &&
                          inquiry.finalDecisionStatus !== 'APPLIED' &&
                          canPrepare &&
                          officiallyOpen && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setDecisionInquiry(inquiry)}
                            >
                              {inquiry.finalDecisionStatus === 'REJECTED'
                                ? 'Revise final decision'
                                : inquiry.finding === 'NOT_GUILTY'
                                  ? 'Select transfer & submit'
                                  : 'Select final action'}
                            </Button>
                          )}
                        {inquiry.finalDecisionStatus === 'APPLIED' && (
                          <p className="text-xs text-text-secondary">
                            Applied — letters stay draft until issued from Letters.
                          </p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
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

      <Dialog open={!!detailInquiry} onOpenChange={(v) => !v && setDetailInquiry(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Inquiry details</DialogTitle>
            <DialogDescription>
              {detailInquiry?.action.employee?.fullName ?? 'Employee'} ·{' '}
              {detailInquiry?.action.type.replace(/_/g, ' ')}
            </DialogDescription>
          </DialogHeader>
          {detailInquiry && (
            <div className="space-y-3 text-sm">
              <p>
                <span className="font-medium">Reason: </span>
                {detailInquiry.action.reason}
              </p>
              <p>
                <span className="font-medium">Inquiry officer: </span>
                {inquiryOfficerLabel(detailInquiry)}
              </p>
              <p>
                <span className="font-medium">Notes: </span>
                {detailInquiry.notes || '—'}
              </p>
              <InquiryFinalState
                inquiry={detailInquiry}
                employeeStatus={detailInquiry.action.employee?.status}
                employeeId={detailInquiry.action.employeeId}
                canRecoverLetters={canPrepare}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <RecordFindingDialog
        inquiry={findingInquiry}
        open={!!findingInquiry}
        onOpenChange={(v) => !v && setFindingInquiry(null)}
      />
      <ProposeFinalDecisionDialog
        inquiry={decisionInquiry}
        open={!!decisionInquiry}
        onOpenChange={(v) => !v && setDecisionInquiry(null)}
      />
      <CloseInquiryDialog
        inquiry={closeInquiry}
        open={!!closeInquiry}
        onOpenChange={(v) => !v && setCloseInquiry(null)}
      />
    </div>
  )
}

function RecordFindingDialog({
  inquiry,
  open,
  onOpenChange,
}: {
  inquiry: Inquiry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [finding, setFinding] = useState<'GUILTY' | 'NOT_GUILTY'>('NOT_GUILTY')
  const [notes, setNotes] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      disciplinaryApi.recordInquiryFinding(inquiry!.id, {
        finding,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Finding recorded', description: finding.replace(/_/g, ' ') })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Could not record finding',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? ''),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record inquiry finding</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            The finding does not change employment status. A separate approved
            decision is required.
          </p>
          <div className="space-y-1">
            <Label>Finding</Label>
            <Select
              value={finding}
              onValueChange={(v) => setFinding(v as 'GUILTY' | 'NOT_GUILTY')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NOT_GUILTY">NOT GUILTY</SelectItem>
                <SelectItem value="GUILTY">GUILTY</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {finding === 'NOT_GUILTY' && (
            <p className="text-sm font-medium text-amber-800">
              NOT GUILTY — they may continue duties at the same branch or another branch.
            </p>
          )}
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Submit finding
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProposeFinalDecisionDialog({
  inquiry,
  open,
  onOpenChange,
}: {
  inquiry: Inquiry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [finalAction, setFinalAction] = useState('DISMISS')
  const [destinationBranchId, setDestinationBranchId] = useState('')
  const [approverId, setApproverId] = useState('')
  const [fineAmount, setFineAmount] = useState('')
  const [notes, setNotes] = useState('')

  const needsDutyBranch =
    inquiry?.finding === 'NOT_GUILTY' || finalAction === 'FINE_AND_REINSTATE'

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
    enabled: open,
  })
  const { data: approvers = [] } = useQuery({
    queryKey: ['disciplinary', 'suspension-approvers'],
    queryFn: () => disciplinaryApi.listEligibleApprovers(),
    enabled: open,
  })

  const currentDutyBranchId = (
    inquiry as Inquiry & { action?: DisciplinaryAction }
  )?.action?.suspensionRequest?.suspendedFromBranchId

  useEffect(() => {
    if (!open || !inquiry) return
    setDestinationBranchId(currentDutyBranchId ?? '')
  }, [open, inquiry, currentDutyBranchId])

  const mutation = useMutation({
    mutationFn: () =>
      disciplinaryApi.submitInquiryFinalDecision(inquiry!.id, {
        selectedApproverUserId: approverId,
        destinationBranchId: needsDutyBranch ? destinationBranchId : undefined,
        finalAction:
          inquiry?.finding === 'GUILTY' ? finalAction : undefined,
        fineAmount:
          finalAction === 'FINE_AND_REINSTATE' ? Number(fineAmount) : undefined,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast({
        title: 'Final decision submitted',
        description: 'Waiting for the selected approver. Nothing has been applied yet.',
      })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Could not submit decision',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? ''),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {inquiry?.finding === 'NOT_GUILTY'
              ? 'Choose duty branch for reinstatement'
              : 'Select final inquiry action'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {inquiry?.finding === 'NOT_GUILTY' && (
            <p className="text-sm font-medium text-amber-800">
              NOT GUILTY — they may continue duties at the same branch or another branch.
            </p>
          )}
          {inquiry?.finding === 'GUILTY' && (
            <div className="space-y-1">
              <Label>Final action</Label>
              <Select value={finalAction} onValueChange={setFinalAction}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DISMISS">Dismiss</SelectItem>
                  <SelectItem value="TERMINATE">Terminate</SelectItem>
                  <SelectItem value="REST">Rest (ON_REST)</SelectItem>
                  <SelectItem value="FINE_AND_REINSTATE">
                    Fine and reinstate
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {needsDutyBranch && (
            <div className="space-y-1">
              <Label>Duty branch</Label>
              <Select
                value={destinationBranchId}
                onValueChange={setDestinationBranchId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Same branch or another branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-text-secondary">
                They may continue at the same branch or be posted to another.
              </p>
            </div>
          )}
          {inquiry?.finding === 'GUILTY' &&
            finalAction === 'FINE_AND_REINSTATE' && (
              <div className="space-y-1">
                <Label>Fine amount</Label>
                <Input
                  type="number"
                  min="1"
                  value={fineAmount}
                  onChange={(e) => setFineAmount(e.target.value)}
                />
              </div>
            )}
          <div className="space-y-1">
            <Label>Approver</Label>
            <Select value={approverId} onValueChange={setApproverId}>
              <SelectTrigger>
                <SelectValue placeholder="Select approver" />
              </SelectTrigger>
              <SelectContent>
                {approvers.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.displayName} ({a.eligibleRole})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={mutation.isPending || !approverId}
            onClick={() => mutation.mutate()}
          >
            Submit for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DisciplinaryPage({
  embedded = false,
  onlyInquiries = false,
}: {
  embedded?: boolean
  onlyInquiries?: boolean
}) {
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const canPrepare = hasRole(['SUPER_ADMIN', 'HR_MANAGER', 'ADMIN_MANAGER'])
  const canClose = hasRole(['SUPER_ADMIN', 'HR_MANAGER', 'ADMIN_MANAGER'])
  const [tab, setTab] = useState(onlyInquiries ? 'inquiries' : 'actions')
  const [newActionOpen, setNewActionOpen] = useState(false)
  const [startInquiryId, setStartInquiryId] = useState<string | null>(null)
  const [resolveInquiry, setResolveInquiry] = useState<Inquiry | null>(null)
  const [prepareAction, setPrepareAction] = useState<DisciplinaryAction | null>(
    null,
  )

  const openCloseInquiry = async (action: DisciplinaryAction) => {
    if (action.inquiry?.id) {
      setResolveInquiry(action.inquiry)
      return
    }
    try {
      const inquiry = await disciplinaryApi.ensureInquiry(action.id)
      await queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
      setResolveInquiry(inquiry)
    } catch (err: unknown) {
      const msg = (
        err as { response?: { data?: { message?: string | string[] } } }
      )?.response?.data?.message
      toast({
        title: 'Could not close inquiry',
        description: Array.isArray(msg)
          ? msg.join(', ')
          : String(msg ?? 'The inquiry record could not be created.'),
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6">
      {!onlyInquiries ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {!embedded ? (
            <h1 className="text-2xl font-bold text-text-primary">
              Disciplinary Management
            </h1>
          ) : (
            <p className="text-sm text-text-secondary">
              Manage cases, inquiries, and suspension preparation (approval
              required before issuing).
            </p>
          )}
          <Button variant="destructive" onClick={() => setNewActionOpen(true)}>
            New Action
          </Button>
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          Employees whose inquiry has been started. Close an inquiry to record
          the verdict (join again, rest, dismiss, or terminate).
        </p>
      )}

      {onlyInquiries ? (
        <InquiriesTab onCloseInquiry={openCloseInquiry} />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="actions">Actions</TabsTrigger>
            <TabsTrigger value="inquiries">Enquiries</TabsTrigger>
          </TabsList>

          <TabsContent value="actions" className="mt-4">
            <ActionsTab
              onStartInquiry={setStartInquiryId}
              onSwitchToInquiries={() => setTab('inquiries')}
              onPrepareSuspension={setPrepareAction}
              onCloseInquiry={openCloseInquiry}
              canPrepare={canPrepare}
              canClose={canClose}
            />
          </TabsContent>

          <TabsContent value="inquiries" className="mt-4">
            <InquiriesTab onCloseInquiry={openCloseInquiry} />
          </TabsContent>
        </Tabs>
      )}

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

      <PrepareSuspensionDialog
        action={prepareAction}
        open={!!prepareAction}
        onOpenChange={(v) => !v && setPrepareAction(null)}
      />
    </div>
  )
}
