import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { leaveApi } from '@/api/endpoints/leave'
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

export type ApprovalRole =
  | 'BRANCH_MANAGER'
  | 'ADMIN_OFFICER'
  | 'HR_OPERATIONS_MANAGER'
  | 'SUPER_ADMIN'

export function ApproveRejectDialog({
  leave,
  role,
  open,
  onOpenChange,
  onSuccess,
}: {
  leave: LeaveRecord | null
  role: ApprovalRole
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const [action, setAction] = useState<'APPROVED' | 'REJECTED'>('APPROVED')
  const [notes, setNotes] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      if (!leave) throw new Error('No leave selected')
      const payload = { action, notes: notes || undefined }
      if (role === 'BRANCH_MANAGER' || (role === 'SUPER_ADMIN' && leave.status === 'PENDING')) {
        return leaveApi.branchApprove(leave.id, payload)
      }
      if (
        role === 'ADMIN_OFFICER' ||
        (role === 'SUPER_ADMIN' && leave.status === 'BRANCH_APPROVED')
      ) {
        return leaveApi.deptApprove(leave.id, payload)
      }
      return leaveApi.hrApprove(leave.id, payload)
    },
    onSuccess: () => {
      toast({
        title: action === 'APPROVED' ? 'Leave approved' : 'Leave rejected',
      })
      setNotes('')
      setAction('APPROVED')
      onOpenChange(false)
      onSuccess()
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

  if (!leave) return null

  const employeeName = leave.employee
    ? `${leave.employee.fullName}`
    : 'Employee'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review Leave Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-border bg-surface p-3">
            <p>
              <span className="text-text-secondary">Employee: </span>
              {employeeName}
            </p>
            <p>
              <span className="text-text-secondary">Dates: </span>
              {format(new Date(leave.startDate), 'dd/MM/yyyy')} —{' '}
              {format(new Date(leave.endDate), 'dd/MM/yyyy')}
            </p>
            <p>
              <span className="text-text-secondary">Days: </span>
              {leave.totalDays}
            </p>
            <p>
              <span className="text-text-secondary">Reason: </span>
              {leave.reason ?? '—'}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Action</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={action === 'APPROVED'}
                  onChange={() => setAction('APPROVED')}
                />
                Approve
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={action === 'REJECTED'}
                  onChange={() => setAction('REJECTED')}
                />
                Reject
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              Notes{action === 'REJECTED' ? ' *' : ''}
            </Label>
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
            {mutation.isPending ? 'Submitting...' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function canApproveLeave(
  role: string | undefined,
  leave: LeaveRecord | null | undefined,
): ApprovalRole | null {
  if (!role || !leave) return null
  if (role === 'SUPER_ADMIN') return 'SUPER_ADMIN'
  if (role === 'BRANCH_MANAGER' && leave.status === 'PENDING') {
    return 'BRANCH_MANAGER'
  }
  if (role === 'ADMIN_OFFICER' && leave.status === 'BRANCH_APPROVED') {
    return 'ADMIN_OFFICER'
  }
  if (
    role === 'HR_OPERATIONS_MANAGER' &&
    (leave.status === 'RELIEVER_CONFIRMED' ||
      leave.status === 'DEPT_APPROVED' ||
      leave.status === 'HR_PENDING')
  ) {
    return 'HR_OPERATIONS_MANAGER'
  }
  return null
}

export function canAssignReliever(
  role: string | undefined,
  leave: LeaveRecord,
): boolean {
  if (!role) return false
  const allowed = [
    'SUPER_ADMIN',
    'HR_MANAGER',
    'HR_ADMIN_MANAGER',
    'ADMIN_OFFICER',
  ]
  if (!allowed.includes(role)) return false
  return (
    leave.status === 'DEPT_APPROVED' ||
    leave.status === 'RELIEVER_REJECTED'
  )
}
