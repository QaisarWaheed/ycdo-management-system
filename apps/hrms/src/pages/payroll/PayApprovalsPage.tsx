import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { AppointmentLetterButton } from '@/components/letters/AppointmentLetterButton'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  APPROVER_OPTIONS,
  type EmployeeApproverTarget,
} from '@/api/endpoints/employeeOnboarding'
import {
  PAY_CHANGE_KIND_LABELS,
  payApprovalsApi,
  type PayChangeRequest,
  type PayChangeStatus,
} from '@/api/endpoints/payApprovals'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { AddIncentiveDialog } from '@/pages/incentives/AddIncentiveDialog'

const approverLabel = (t: EmployeeApproverTarget) =>
  APPROVER_OPTIONS.find((o) => o.value === t)?.label ?? t
const personName = (p?: { email: string; employee?: { fullName: string } | null } | null) =>
  p?.employee?.fullName ?? p?.email ?? '—'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

type Action = { kind: 'approve' | 'reject' | 'forward' | 'cancel'; request: PayChangeRequest }

const pkr = (n: number) => Math.round(n).toLocaleString('en-PK')
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Amount this request adds (incentives / payroll additions carry it in the payload). */
const requestAmount = (r: PayChangeRequest) => Number(r.payload?.amount) || 0

/** That month's pay before this change; `full` adds the net after approval. */
function PayFacts({ request, full = false }: { request: PayChangeRequest; full?: boolean }) {
  const p = request.pay
  if (!p) return null
  const add = requestAmount(request)
  const cells: Array<[string, number, string?]> = [
    ['Basic (contract)', p.contractBasic],
    ['Earned basic', p.earnedBasic],
    ['Allowances', p.allowances],
    ['Incentives', p.incentives],
    ['Deductions', p.deductions, 'text-red-600'],
    ['Net', p.net, 'font-semibold'],
  ]
  return (
    <div className={full ? 'rounded-md border p-2' : 'mt-1'}>
      <div className="text-xs font-medium text-muted-foreground">
        {MONTH_SHORT[p.month - 1]} {p.year} pay{p.status !== 'PENDING' ? ` · ${p.status}` : ''}
      </div>
      <div className={full ? 'mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm' : 'text-xs text-muted-foreground'}>
        {cells.map(([label, value, cls]) =>
          full ? (
            <div key={label} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{label}</span>
              <span className={`tabular-nums ${cls ?? ''}`}>{pkr(value)}</span>
            </div>
          ) : (
            <span key={label} className="mr-2 whitespace-nowrap">
              {label} <b className={`tabular-nums ${cls ?? ''}`}>{pkr(value)}</b>
            </span>
          ),
        )}
      </div>
      {full && add > 0 && p.status === 'PENDING' && !request.blockedReason ? (
        <div className="mt-1 flex justify-between border-t pt-1 text-sm font-semibold text-green-700">
          <span>Net after approval</span>
          <span className="tabular-nums">{pkr(p.net + add)}</span>
        </div>
      ) : null}
    </div>
  )
}

/** Executive queue for pay increases (increments, allowances, incentives, additions). */
export function PayApprovalsPage() {
  const { hasRole } = useAuth()
  const canDecide = hasRole(['PRESIDENT', 'FOUNDER', 'CHAIRMAN', 'SUPER_ADMIN'])
  const canForward = hasRole(['IT_ADMIN', 'SUPER_ADMIN'])
  // Finance sends the requests, so Finance may correct or withdraw them.
  const canAmend = hasRole(['PAYROLL_OFFICER', 'SUPER_ADMIN'])
  const [editRequest, setEditRequest] = useState<PayChangeRequest | null>(null)
  const [status, setStatus] = useState<PayChangeStatus>('PENDING')
  const [action, setAction] = useState<Action | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)

  const { data = [], isLoading } = useQuery({
    queryKey: ['pay-approvals', 'list', status],
    queryFn: () => payApprovalsApi.list({ status }),
  })
  const bulk = status === 'PENDING' && canDecide
  // Requests that would fail (e.g. On Rest) cannot be ticked.
  const selectable = data.filter((r) => !r.blockedReason)
  const picked = data.filter((r) => selected.has(r.id))
  const allPicked = selectable.length > 0 && selectable.every((r) => selected.has(r.id))
  const rowActions = (r: PayChangeRequest) => (
    <>
      {status === 'PENDING' && canDecide ? (
        <>
          <Button
            size="sm"
            disabled={!!r.blockedReason}
            title={r.blockedReason ?? undefined}
            onClick={() => setAction({ kind: 'approve', request: r })}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAction({ kind: 'reject', request: r })}
          >
            Reject
          </Button>
        </>
      ) : null}
      {status === 'PENDING' && hasRole(['SUPER_ADMIN']) && r.kind === 'INCENTIVE' ? (
        <Button size="sm" variant="outline" onClick={() => setEditRequest(r)}>
          Edit
        </Button>
      ) : null}
      {status === 'PENDING' && canAmend ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAction({ kind: 'cancel', request: r })}
        >
          Cancel request
        </Button>
      ) : null}
      {status === 'PENDING' && canForward ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAction({ kind: 'forward', request: r })}
        >
          Forward
        </Button>
      ) : null}
    </>
  )
  const when = (r: PayChangeRequest) =>
    format(
      new Date(status === 'PENDING' ? r.createdAt : (r.reviewedAt ?? r.createdAt)),
      'dd MMM yyyy, h:mm a',
    )
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Pay Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Salary increments, allowances, incentives and payroll additions sent by HR / Accounts.
          They reach payroll only after approval.
        </p>
      </div>
      <Tabs
        value={status}
        onValueChange={(v) => {
          setStatus(v as PayChangeStatus)
          setSelected(new Set())
        }}
      >
        <TabsList>
          <TabsTrigger value="PENDING">Pending</TabsTrigger>
          <TabsTrigger value="APPROVED">Approved</TabsTrigger>
          <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
          <TabsTrigger value="CANCELLED">Cancelled</TabsTrigger>
        </TabsList>
      </Tabs>
      {bulk && selectable.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={allPicked}
              onChange={() =>
                setSelected(allPicked ? new Set() : new Set(selectable.map((r) => r.id)))
              }
            />
            Select all ({selectable.length})
          </label>
          <span className="text-muted-foreground">
            {picked.length} selected
            {picked.length ? ` · PKR ${pkr(picked.reduce((s, r) => s + requestAmount(r), 0))}` : ''}
          </span>
          <Button size="sm" disabled={!picked.length} onClick={() => setBulkOpen(true)}>
            Approve selected
          </Button>
          <span className="text-xs text-muted-foreground">
            Or approve / reject one by one with the buttons on each request.
          </span>
        </div>
      ) : null}
      {/* Phones: one card per request, everything wraps; no sideways scrolling. */}
      <div className="space-y-3 md:hidden">
        {isLoading ? (
          <p className="text-center text-sm">Loading…</p>
        ) : data.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">Nothing here</p>
        ) : (
          data.map((r) => (
            <Card key={r.id} className={r.blockedReason ? 'border-red-200 bg-red-50/60' : undefined}>
              <CardContent className="space-y-2 p-3 text-sm">
                <div className="flex items-start gap-2">
                  {bulk ? (
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 shrink-0"
                      aria-label={`Select ${r.employee?.fullName ?? 'request'}`}
                      disabled={!!r.blockedReason}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      <EmployeeNameLink employee={r.employee} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[r.employee?.employeeCode, r.employee?.currentDesignation, r.employee?.currentBranch?.name]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  {requestAmount(r) ? (
                    <div className="shrink-0 text-base font-bold tabular-nums">{pkr(requestAmount(r))}</div>
                  ) : null}
                </div>
                {r.blockedReason ? (
                  <p className="text-xs font-medium text-red-700">{r.blockedReason}</p>
                ) : null}
                <div>
                  <Badge variant="outline">{PAY_CHANGE_KIND_LABELS[r.kind]}</Badge>
                  {r.payload?._editedAt ? (
                    <Badge variant="secondary" className="ml-1">
                      Edited
                    </Badge>
                  ) : null}
                  <div className="mt-1 font-medium">{r.summary}</div>
                  <RequestNotification request={r} />
                  {r.reason ? <div className="text-xs text-muted-foreground">Reason: {r.reason}</div> : null}
                  {r.reviewNote ? (
                    <div className="text-xs text-muted-foreground">Note: {r.reviewNote}</div>
                  ) : null}
                </div>
                <PayFacts request={r} full />
                <div className="text-xs text-muted-foreground">
                  {personName(r.submittedBy)} →{' '}
                  <b className="text-foreground">
                    {status === 'PENDING' ? approverLabel(r.approverTarget) : personName(r.reviewedBy)}
                  </b>{' '}
                  · {when(r)}
                </div>
                <div className="flex flex-wrap gap-2">{rowActions(r)}</div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      <Card className="hidden md:block">
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {bulk ? <TableHead className="w-8" /> : null}
                <TableHead>Employee</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Sent by</TableHead>
                <TableHead>{status === 'PENDING' ? 'Waiting with' : 'Decided by'}</TableHead>
                <TableHead>{status === 'PENDING' ? 'Sent on' : 'Decided on'}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={bulk ? 7 : 6} className="text-center">Loading…</TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={bulk ? 7 : 6} className="text-center text-muted-foreground">
                    Nothing here
                  </TableCell>
                </TableRow>
              ) : (
                data.map((r) => (
                  <TableRow key={r.id} className={r.blockedReason ? 'bg-red-50/60' : undefined}>
                    {bulk ? (
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          aria-label={`Select ${r.employee?.fullName ?? 'request'}`}
                          disabled={!!r.blockedReason}
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell>
                      {/* Req 15: open the employee's profile; Req 14: appointment letter. */}
                      <div className="font-medium">
                        <EmployeeNameLink employee={r.employee} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.employee?.employeeCode}
                        {r.employee?.currentDesignation ? ` · ${r.employee.currentDesignation}` : ''}
                        {r.employee?.currentBranch?.name ? ` · ${r.employee.currentBranch.name}` : ''}
                      </div>
                      <div className="mt-1">
                        <AppointmentLetterButton employeeId={r.employee?.id} />
                      </div>
                      {r.blockedReason ? (
                        <div className="mt-1 max-w-xs text-xs font-medium text-red-700">
                          {r.blockedReason}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-md">
                      <Badge variant="outline">{PAY_CHANGE_KIND_LABELS[r.kind]}</Badge>
                      {r.payload?._editedAt ? (
                        <Badge variant="secondary" className="ml-1">
                          Edited
                        </Badge>
                      ) : null}
                      <div className="mt-1 font-medium">{r.summary}</div>
                      <RequestNotification request={r} />
                      {r.reason ? (
                        <div className="text-xs text-muted-foreground">Reason: {r.reason}</div>
                      ) : null}
                      {r.reviewNote ? (
                        <div className="text-xs text-muted-foreground">Note: {r.reviewNote}</div>
                      ) : null}
                      <PayFacts request={r} />
                    </TableCell>
                    <TableCell>{personName(r.submittedBy)}</TableCell>
                    <TableCell className="font-semibold">
                      {status === 'PENDING'
                        ? approverLabel(r.approverTarget)
                        : personName(r.reviewedBy)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{when(r)}</TableCell>
                    <TableCell className="space-x-1 whitespace-nowrap text-right">
                      {rowActions(r)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {action ? <DecisionDialog action={action} onClose={() => setAction(null)} /> : null}
      {bulkOpen ? (
        <BulkApproveDialog
          requests={picked}
          onClose={(done) => {
            setBulkOpen(false)
            if (done) setSelected(new Set())
          }}
        />
      ) : null}
      <AddIncentiveDialog
        open={!!editRequest}
        onOpenChange={(o) => !o && setEditRequest(null)}
        editRequest={editRequest}
      />
    </div>
  )
}

function DecisionDialog({ action, onClose }: { action: Action; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { request, kind } = action
  const others = APPROVER_OPTIONS.filter((o) => o.value !== request.approverTarget)
  const [note, setNote] = useState('')
  const [target, setTarget] = useState<EmployeeApproverTarget>(others[0].value)

  const mutation = useMutation({
    mutationFn: () =>
      kind === 'approve'
        ? payApprovalsApi.approve(request.id, note.trim() || undefined)
        : kind === 'reject'
          ? payApprovalsApi.reject(request.id, note.trim())
          : kind === 'cancel'
            ? payApprovalsApi.cancel(request.id, note.trim())
            : payApprovalsApi.forward(request.id, target, note.trim()),
    onSuccess: () => {
      toast({
        title:
          kind === 'approve'
            ? 'Approved and applied to payroll'
            : kind === 'reject'
              ? 'Request rejected'
              : kind === 'cancel'
                ? 'Request cancelled'
                : `Forwarded to ${approverLabel(target)}`,
      })
      queryClient.invalidateQueries({ queryKey: ['pay-approvals'] })
      queryClient.invalidateQueries({ queryKey: ['employee-allowances'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['incentives'] })
      onClose()
    },
    onError: (err: ApiError) =>
      toast({ title: 'Could not complete', description: errText(err), variant: 'destructive' }),
  })

  const needsNote = kind !== 'approve'
  const title =
    kind === 'approve'
      ? 'Approve pay change'
      : kind === 'reject'
        ? 'Reject pay change'
        : kind === 'cancel'
          ? 'Cancel this request'
          : 'Forward request'

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-semibold">{request.employee?.fullName}</p>
            <p className="text-xs text-muted-foreground">
              {[
                request.employee?.employeeCode,
                request.employee?.currentDesignation,
                request.employee?.currentBranch?.name,
                request.employee?.status?.replace(/_/g, ' '),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="mt-1">{request.summary}</p>
            {request.reason ? (
              <p className="text-xs text-muted-foreground">Reason: {request.reason}</p>
            ) : null}
          </div>
          <PayFacts request={request} full />
          {request.blockedReason ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-2 text-red-700">
              {request.blockedReason}
            </p>
          ) : null}
          {kind === 'approve' ? (
            <p className="text-muted-foreground">
              This is applied to payroll right away. If its month is already processed or paid, it
              starts from the next open month.
            </p>
          ) : null}
          {kind === 'forward' ? (
            <div className="space-y-1">
              <Label>Forward to</Label>
              <Select value={target} onValueChange={(v) => setTarget(v as EmployeeApproverTarget)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {others.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="decision-note">
              {kind === 'approve' ? 'Note (optional)' : 'Reason'}
            </Label>
            <Textarea id="decision-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant={kind === 'reject' || kind === 'cancel' ? 'destructive' : 'default'}
            disabled={(needsNote && note.trim().length < 5) || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {kind === 'approve'
              ? 'Approve'
              : kind === 'reject'
                ? 'Reject'
                : kind === 'cancel'
                  ? 'Cancel request'
                  : 'Forward'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Approve the ticked requests one after another; failures are listed, the rest go through. */
function BulkApproveDialog({
  requests,
  onClose,
}: {
  requests: PayChangeRequest[]
  onClose: (done: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [failed, setFailed] = useState<Array<{ id: string; error: string }>>([])
  const total = requests.reduce((s, r) => s + requestAmount(r), 0)
  const nameOf = (id: string) => requests.find((r) => r.id === id)?.employee?.fullName ?? id

  const mutation = useMutation({
    mutationFn: () => payApprovalsApi.approveMany(requests.map((r) => r.id), note.trim() || undefined),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['pay-approvals'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['incentives'] })
      queryClient.invalidateQueries({ queryKey: ['employee-allowances'] })
      toast({
        title: `${res.approved.length} approved${res.failed.length ? `, ${res.failed.length} could not be approved` : ''}`,
        variant: res.failed.length ? 'destructive' : undefined,
      })
      if (res.failed.length) setFailed(res.failed)
      else onClose(true)
    },
    onError: (err: ApiError) =>
      toast({ title: 'Could not complete', description: errText(err), variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(failed.length > 0)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Approve {requests.length} requests</DialogTitle>
        </DialogHeader>
        {failed.length ? (
          <div className="space-y-2 text-sm">
            <p>These could not be approved; the others were applied:</p>
            <ul className="space-y-1">
              {failed.map((f) => (
                <li key={f.id} className="rounded border border-red-200 bg-red-50 p-2 text-red-700">
                  <b>{nameOf(f.id)}</b>: {f.error}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {requests.map((r) => (
                <div key={r.id} className="flex justify-between gap-2 border-b px-2 py-1 last:border-b-0">
                  <span>
                    <b>{r.employee?.fullName}</b>
                    <span className="text-xs text-muted-foreground">
                      {r.employee?.currentDesignation ? ` · ${r.employee.currentDesignation}` : ''}
                    </span>
                  </span>
                  <span className="tabular-nums">{requestAmount(r) ? pkr(requestAmount(r)) : r.summary}</span>
                </div>
              ))}
            </div>
            <p className="font-semibold">Total PKR {pkr(total)}</p>
            <p className="text-muted-foreground">
              Each is applied to payroll right away. If its month is already processed or paid, it
              starts from the next open month.
            </p>
            <div className="space-y-1">
              <Label htmlFor="bulk-note">Note (optional)</Label>
              <Textarea id="bulk-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(failed.length > 0)}>
            Close
          </Button>
          {failed.length ? null : (
            <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? 'Approving…' : `Approve ${requests.length}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Basic / increment requests carry the signed notification Finance attached. */
function RequestNotification({ request }: { request: PayChangeRequest }) {
  if (request.attachmentUrl) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-1 h-7"
        onClick={async () => {
          const blob = await payApprovalsApi.attachment(request.id)
          window.open(URL.createObjectURL(blob), '_blank')
        }}
      >
        View signed notification
      </Button>
    )
  }
  if (request.payload?._needsNotification) {
    return <AttachNotification request={request} />
  }
  return null
}

function AttachNotification({ request }: { request: PayChangeRequest }) {
  const queryClient = useQueryClient()
  const canAttach = useAuth().hasRole(['PAYROLL_OFFICER', 'SUPER_ADMIN']) && request.status === 'PENDING'
  const mutation = useMutation({
    mutationFn: (file: File) => payApprovalsApi.attach(request.id, file),
    onSuccess: () => {
      toast({ title: 'Signed notification attached' })
      queryClient.invalidateQueries({ queryKey: ['pay-approvals'] })
    },
    onError: () => toast({ title: 'Could not attach the file', variant: 'destructive' }),
  })
  return (
    <div className="mt-1 space-y-1">
      <div className="text-xs font-medium text-red-700">
        Signed notification not attached yet. It cannot be approved until Finance attaches it.
      </div>
      {canAttach ? (
        <label className="inline-flex cursor-pointer items-center rounded border border-border px-2 py-1 text-xs font-medium">
          {mutation.isPending ? 'Uploading…' : 'Attach signed notification'}
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) mutation.mutate(file)
            }}
          />
        </label>
      ) : null}
    </div>
  )
}
