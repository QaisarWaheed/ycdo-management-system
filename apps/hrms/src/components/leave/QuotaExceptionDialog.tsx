import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { leaveApi } from '@/api/endpoints/leave'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import type { LeaveRecord } from '@/types'

/**
 * A leave created directly by HR (Emergency Full Leave, or the HR-emergency
 * Short Leave attendance-edit flow) always has currentStage=null — it never
 * enters the branch/dept/reliever/HR_OPERATIONS chain. A leave that DID go
 * through the chain always has a currentStage set. This is a heuristic, not
 * a stored flag, hence "likely" in the label — the backend has no explicit
 * source-flow field to read instead.
 */
function likelySourceFlow(leave: LeaveRecord): string {
  return leave.currentStage == null ? 'HR Emergency (likely)' : 'Portal Request'
}

export function QuotaExceptionDialog({
  leave,
  open,
  onOpenChange,
  onSuccess,
}: {
  leave: LeaveRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const [action, setAction] = useState<'APPROVED' | 'REJECTED'>('APPROVED')
  const [notes, setNotes] = useState('')

  const { data: quotaContext, isLoading: quotaLoading } = useQuery({
    queryKey: ['leave-quota-context', leave?.id],
    queryFn: () => leaveApi.getQuotaContext(leave!.id),
    enabled: open && !!leave,
  })

  const mutation = useMutation({
    mutationFn: () => {
      if (!leave) throw new Error('No leave selected')
      return leaveApi.decideQuotaException(leave.id, {
        action,
        notes: notes || undefined,
      })
    },
    onSuccess: () => {
      toast({
        title:
          action === 'APPROVED'
            ? 'Extra leave approved'
            : 'Extra leave rejected',
      })
      setNotes('')
      setAction('APPROVED')
      onOpenChange(false)
      onSuccess()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Decision failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  if (!leave) return null

  const employeeName = leave.employee ? leave.employee.fullName : 'Employee'
  const isFullLeave = leave.leaveType !== 'SHORT_LEAVE'
  const leaveKindLabel = isFullLeave ? 'Full Leave' : 'Short Leave'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quota Exception — {leaveKindLabel}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-border bg-surface p-3 space-y-1">
            <p>
              <span className="text-text-secondary">Employee: </span>
              {employeeName}
            </p>
            <p>
              <span className="text-text-secondary">Leave type: </span>
              {leaveKindLabel}
            </p>
            <p>
              <span className="text-text-secondary">Date: </span>
              {format(new Date(leave.startDate), 'dd/MM/yyyy')}
              {leave.endDate !== leave.startDate
                ? ` — ${format(new Date(leave.endDate), 'dd/MM/yyyy')}`
                : ''}
            </p>
            <p>
              <span className="text-text-secondary">Source: </span>
              {likelySourceFlow(leave)}
            </p>
            <p>
              <span className="text-text-secondary">Reason: </span>
              {leave.reason ?? '—'}
            </p>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="font-medium text-amber-900">Monthly usage</p>
            {quotaLoading ? (
              <p className="text-amber-800">Loading…</p>
            ) : quotaContext ? (
              <p className="text-amber-800">
                {quotaContext.monthlyOccurrenceCount} of{' '}
                {quotaContext.monthlyLimit} normal {leaveKindLabel.toLowerCase()}
                {quotaContext.monthlyLimit === 1 ? '' : 's'} already used this
                month (excluding this request).{' '}
                <Badge variant="outline" className="ml-1 border-amber-300 bg-amber-100 text-amber-900">
                  Beyond entitlement
                </Badge>
              </p>
            ) : (
              <p className="text-amber-800">Unable to load usage.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Decision</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={action === 'APPROVED'}
                  onChange={() => setAction('APPROVED')}
                />
                Approve — treat as normal {leaveKindLabel.toLowerCase()}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={action === 'REJECTED'}
                  onChange={() => setAction('REJECTED')}
                />
                Reject
                {isFullLeave ? ' — applies a 1-day deduction' : ''}
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Decision reason{action === 'REJECTED' ? ' *' : ''}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                action === 'REJECTED'
                  ? 'Reason for rejection (required)'
                  : 'Optional notes'
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending || (action === 'REJECTED' && !notes.trim())
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Submitting...' : 'Submit Decision'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
