import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { disciplinaryApi } from '@/api/endpoints/disciplinary'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}
const EXECUTIVES = ['CHAIRMAN', 'PRESIDENT', 'FOUNDER', 'SUPER_ADMIN'] as const
export const INQUIRY_SUSPEND_ROLES = [
  'SUPER_ADMIN',
  'HR_OPERATIONS_MANAGER',
  'HR_MANAGER',
  'HR_ADMIN_MANAGER',
  'CHAIRMAN',
  'PRESIDENT',
  'FOUNDER',
] as const

/** Req 9: suspend from inside an inquiry. HR asks an executive; an executive suspends at once. */
export function SuspendInquiryDialog({
  inquiryId,
  employeeName,
  onClose,
}: {
  inquiryId: string
  employeeName: string
  onClose: () => void
}) {
  const { hasRole } = useAuth()
  const isExecutive = hasRole([...EXECUTIVES])
  const queryClient = useQueryClient()
  const [suspendFrom, setSuspendFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [reason, setReason] = useState('')
  const [approverUserId, setApproverUserId] = useState('')
  const { data: approvers = [] } = useQuery({
    queryKey: ['disciplinary', 'inquiry-suspend-approvers'],
    queryFn: () => disciplinaryApi.inquirySuspendApprovers(),
    enabled: !isExecutive,
  })
  const mutation = useMutation({
    mutationFn: () =>
      disciplinaryApi.suspendFromInquiry(inquiryId, {
        suspendFrom,
        reason: reason.trim(),
        approverUserId: isExecutive ? undefined : approverUserId,
      }),
    onSuccess: (res) => {
      toast({
        title:
          res.status === 'PENDING_APPROVAL'
            ? 'Sent to the executive for approval'
            : `${employeeName} suspended — notice issued`,
      })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
      queryClient.invalidateQueries({ queryKey: ['employee'] })
      onClose()
    },
    onError: (err: ApiError) =>
      toast({ title: 'Could not suspend', description: errText(err), variant: 'destructive' }),
  })
  const valid = !!suspendFrom && reason.trim().length >= 3 && (isExecutive || !!approverUserId)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Suspend {employeeName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="suspend-from">Suspended from</Label>
            <Input id="suspend-from" type="date" value={suspendFrom} onChange={(e) => setSuspendFrom(e.target.value)} />
            <p className="text-xs text-muted-foreground">Pay stops from this date until the inquiry is closed.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="suspend-reason">Reason</Label>
            <Textarea id="suspend-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {!isExecutive ? (
            <div className="space-y-1">
              <Label htmlFor="suspend-approver">Approved by</Label>
              <select
                id="suspend-approver"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={approverUserId}
                onChange={(e) => setApproverUserId(e.target.value)}
              >
                <option value="">Choose Chairman / President / Founder…</option>
                {approvers.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName} ({a.eligibleRole.toLowerCase()})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                The employee is suspended and the notice issued once the executive approves.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              As an executive your suspension applies at once and the Suspension Notice is issued.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {isExecutive ? 'Suspend now' : 'Send for approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Req 9: suspensions waiting for this executive. */
export function PendingInquirySuspendsCard() {
  const { hasRole } = useAuth()
  const canReview = hasRole([...EXECUTIVES])
  const queryClient = useQueryClient()
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const { data = [] } = useQuery({
    queryKey: ['disciplinary', 'inquiry-suspend-approvals'],
    queryFn: () => disciplinaryApi.myPendingInquirySuspends(),
    enabled: canReview,
  })
  const done = (title: string) => {
    toast({ title })
    setRejecting(null)
    setReason('')
    queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
  }
  const onError = (err: ApiError) =>
    toast({ title: 'Failed', description: errText(err), variant: 'destructive' })
  const approve = useMutation({
    mutationFn: (id: string) => disciplinaryApi.approveInquirySuspend(id),
    onSuccess: () => done('Suspended — notice issued'),
    onError,
  })
  const reject = useMutation({
    mutationFn: () => disciplinaryApi.rejectInquirySuspend(rejecting!, reason.trim()),
    onSuccess: () => done('Suspension not approved'),
    onError,
  })
  if (!canReview || data.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Suspensions waiting for your approval</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
            <div>
              <div className="font-medium">
                {p.disciplinaryAction.employee.fullName} ({p.disciplinaryAction.employee.employeeCode ?? '—'})
              </div>
              <div className="text-muted-foreground">
                {p.disciplinaryAction.employee.currentBranch?.name ?? '—'} · from{' '}
                {format(new Date(p.suspendFrom), 'dd/MM/yyyy')} · {p.suspendReason}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setRejecting(p.id)}>
                Reject
              </Button>
              <Button size="sm" variant="destructive" disabled={approve.isPending} onClick={() => approve.mutate(p.id)}>
                Approve suspension
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
      <Dialog open={!!rejecting} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject suspension</DialogTitle>
          </DialogHeader>
          <Textarea placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button disabled={reason.trim().length < 3 || reject.isPending} onClick={() => reject.mutate()}>
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
