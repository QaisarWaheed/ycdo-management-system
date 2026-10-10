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

const approverLabel = (t: EmployeeApproverTarget) =>
  APPROVER_OPTIONS.find((o) => o.value === t)?.label ?? t
const personName = (p?: { email: string; employee?: { fullName: string } | null } | null) =>
  p?.employee?.fullName ?? p?.email ?? '—'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

type Action = { kind: 'approve' | 'reject' | 'forward'; request: PayChangeRequest }

/** Executive queue for pay increases (increments, allowances, incentives, additions). */
export function PayApprovalsPage() {
  const { hasRole } = useAuth()
  const canDecide = hasRole(['PRESIDENT', 'FOUNDER', 'CHAIRMAN', 'SUPER_ADMIN'])
  const canForward = hasRole(['IT_ADMIN', 'SUPER_ADMIN'])
  const [status, setStatus] = useState<PayChangeStatus>('PENDING')
  const [action, setAction] = useState<Action | null>(null)

  const { data = [], isLoading } = useQuery({
    queryKey: ['pay-approvals', 'list', status],
    queryFn: () => payApprovalsApi.list({ status }),
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
      <Tabs value={status} onValueChange={(v) => setStatus(v as PayChangeStatus)}>
        <TabsList>
          <TabsTrigger value="PENDING">Pending</TabsTrigger>
          <TabsTrigger value="APPROVED">Approved</TabsTrigger>
          <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
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
                  <TableCell colSpan={6} className="text-center">Loading…</TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Nothing here
                  </TableCell>
                </TableRow>
              ) : (
                data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.employee?.fullName ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.employee?.employeeCode}
                        {r.employee?.currentDesignation ? ` · ${r.employee.currentDesignation}` : ''}
                        {r.employee?.currentBranch?.name ? ` · ${r.employee.currentBranch.name}` : ''}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-md">
                      <Badge variant="outline">{PAY_CHANGE_KIND_LABELS[r.kind]}</Badge>
                      <div className="mt-1 font-medium">{r.summary}</div>
                      {r.reason ? (
                        <div className="text-xs text-muted-foreground">Reason: {r.reason}</div>
                      ) : null}
                      {r.reviewNote ? (
                        <div className="text-xs text-muted-foreground">Note: {r.reviewNote}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>{personName(r.submittedBy)}</TableCell>
                    <TableCell className="font-semibold">
                      {status === 'PENDING'
                        ? approverLabel(r.approverTarget)
                        : personName(r.reviewedBy)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {format(
                        new Date(status === 'PENDING' ? r.createdAt : (r.reviewedAt ?? r.createdAt)),
                        'dd MMM yyyy, h:mm a',
                      )}
                    </TableCell>
                    <TableCell className="space-x-1 whitespace-nowrap text-right">
                      {status === 'PENDING' && canDecide ? (
                        <>
                          <Button size="sm" onClick={() => setAction({ kind: 'approve', request: r })}>
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
                      {status === 'PENDING' && canForward ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAction({ kind: 'forward', request: r })}
                        >
                          Forward
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {action ? <DecisionDialog action={action} onClose={() => setAction(null)} /> : null}
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
          : payApprovalsApi.forward(request.id, target, note.trim()),
    onSuccess: () => {
      toast({
        title:
          kind === 'approve'
            ? 'Approved and applied to payroll'
            : kind === 'reject'
              ? 'Request rejected'
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
        : 'Forward request'

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            <b>{request.employee?.fullName}</b> — {request.summary}
          </p>
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
            Cancel
          </Button>
          <Button
            variant={kind === 'reject' ? 'destructive' : 'default'}
            disabled={(needsNote && note.trim().length < 5) || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {kind === 'approve' ? 'Approve' : kind === 'reject' ? 'Reject' : 'Forward'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
