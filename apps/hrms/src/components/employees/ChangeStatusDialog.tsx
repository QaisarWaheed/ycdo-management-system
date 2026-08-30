import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { employeesApi } from '@/api/endpoints/employees'
import { SearchableSelect } from '@/components/common/SearchableSelect'
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
import { StatusBadge } from '@/components/employees/StatusBadge'
import { toast } from '@/hooks/use-toast'
import {
  enumValueToLabel,
  labelToEnumValue,
} from '@/lib/searchableSelectOptions'
import { EMPLOYEE_STATUSES, type EmployeeStatus } from '@/types'

function statusesForChange(currentStatus: string): EmployeeStatus[] {
  return EMPLOYEE_STATUSES.filter((s) => {
    if (
      s === currentStatus ||
      s === 'DISMISSED' ||
      s === 'ON_LEAVE' ||
      s === 'PENDING_APPROVAL'
    ) {
      return false
    }
    if (s === 'SUSPENDED') return false
    return true
  })
}

interface ChangeStatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeId: string
  currentStatus: string
}

export function ChangeStatusDialog({
  open,
  onOpenChange,
  employeeId,
  currentStatus,
}: ChangeStatusDialogProps) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<EmployeeStatus>('ACTIVE')
  const [reason, setReason] = useState('')

  const availableStatuses = statusesForChange(currentStatus)
  const statusOptions = availableStatuses.map(enumValueToLabel)
  const isDismissed = currentStatus === 'DISMISSED'
  const isPendingApproval = currentStatus === 'PENDING_APPROVAL'
  const statusLocked = isDismissed || isPendingApproval

  useEffect(() => {
    if (open) {
      const next = statusesForChange(currentStatus)
      if (next.length > 0) setStatus(next[0])
      setReason('')
    }
  }, [open, currentStatus])

  const mutation = useMutation({
    mutationFn: () =>
      employeesApi.changeStatus(employeeId, { status, reason: reason.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      onOpenChange(false)
      setReason('')
      toast({ title: 'Employee status updated' })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to update status',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Employee Status</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isDismissed && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              This employee has been dismissed and cannot change status. Dismissed
              employees are permanently barred from rejoining.
            </p>
          )}

          {isPendingApproval && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              This employee is pending executive approval. Status becomes Active
              (or Terminated on rejection) only when the assigned President,
              Founder, or Chairman reviews the onboarding request.
            </p>
          )}

          {currentStatus === 'ACTIVE' && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              Suspended is not set from here. Use Letters → Watchlist → Start
              Inquiry. They stay Active until inquiry opening is approved.
            </p>
          )}

          <div>
            <Label className="text-text-secondary">Current Status</Label>
            <div className="mt-1">
              <StatusBadge status={currentStatus} />
            </div>
          </div>

          <SearchableSelect
            label="New Status"
            options={statusOptions}
            value={enumValueToLabel(status)}
            onChange={(label) =>
              setStatus(
                labelToEnumValue(label, availableStatuses) as EmployeeStatus,
              )
            }
            placeholder="Select status"
            disabled={statusLocked}
          />

          <div className="space-y-2">
            <Label>Reason *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for status change"
              disabled={statusLocked}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={statusLocked || !reason.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Updating...' : 'Update Status'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
