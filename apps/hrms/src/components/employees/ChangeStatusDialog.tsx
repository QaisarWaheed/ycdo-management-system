import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { employeesApi } from '@/api/endpoints/employees'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/employees/StatusBadge'
import { toast } from '@/hooks/use-toast'
import { EMPLOYEE_STATUSES, type EmployeeStatus } from '@/types'

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

  const availableStatuses = EMPLOYEE_STATUSES.filter((s) => s !== currentStatus)

  const mutation = useMutation({
    mutationFn: () => employeesApi.changeStatus(employeeId, { status, reason }),
    onSuccess: () => {
      toast({ title: 'Employee status updated' })
      queryClient.invalidateQueries({ queryKey: ['employee', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      onOpenChange(false)
      setReason('')
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
          <div>
            <Label className="text-text-secondary">Current Status</Label>
            <div className="mt-1">
              <StatusBadge status={currentStatus} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>New Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as EmployeeStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableStatuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Reason *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for status change"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={!reason.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Updating...' : 'Update Status'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
