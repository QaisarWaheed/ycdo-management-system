import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { disciplinaryApi } from '@/api/endpoints/disciplinary'
import { DateInput } from '@/components/common/DateInput'
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
import { toast } from '@/hooks/use-toast'
import { ROLE_LABELS } from '@/lib/roleLabels'
import type { DisciplinaryAction } from '@/types'

function toIsoDate(value: string) {
  return value ? `${value}T00:00:00.000Z` : ''
}

export function PrepareSuspensionDialog({
  action,
  open,
  onOpenChange,
}: {
  action: DisciplinaryAction | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const existing = action?.suspensionRequest
  const [reason, setReason] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [inquiryDeadlineAt, setInquiryDeadlineAt] = useState('')
  const [inquiryOfficerUserId, setInquiryOfficerUserId] = useState('')
  const [selectedApproverUserId, setSelectedApproverUserId] = useState('')

  useEffect(() => {
    if (open && action) {
      setReason(action.reason)
      setPeriodStart('')
      setPeriodEnd('')
      setInquiryDeadlineAt('')
      setInquiryOfficerUserId('')
      setSelectedApproverUserId('')
    }
  }, [open, action])

  const { data: approvers = [] } = useQuery({
    queryKey: ['disciplinary', 'suspension-approvers'],
    queryFn: () => disciplinaryApi.listEligibleApprovers(),
    enabled: open,
  })

  const { data: officers = [] } = useQuery({
    queryKey: ['disciplinary', 'inquiry-officers'],
    queryFn: () => disciplinaryApi.listInquiryOfficers(),
    enabled: open,
  })

  const payload = () => ({
    reason,
    periodStart: toIsoDate(periodStart),
    periodEnd: toIsoDate(periodEnd),
    inquiryDeadlineAt: toIsoDate(inquiryDeadlineAt),
    inquiryOfficerUserId,
    selectedApproverUserId,
  })

  const prepareMutation = useMutation({
    mutationFn: async (submitAfter: boolean) => {
      if (!action) throw new Error('Missing action')
      let requestId = existing?.id
      if (requestId && (existing?.status === 'DRAFT' || existing?.status === 'REJECTED')) {
        await disciplinaryApi.updateSuspensionRequest(requestId, payload())
      } else {
        const created = await disciplinaryApi.prepareSuspension(
          action.id,
          payload(),
        )
        requestId = created.id
      }
      if (submitAfter && requestId) {
        await disciplinaryApi.submitSuspensionRequest(requestId)
      }
    },
    onSuccess: (_data, submitAfter) => {
      toast({
        title: submitAfter
          ? 'Submitted for approval'
          : 'Suspension draft saved',
        description: submitAfter
          ? 'Employee status is unchanged until an approved letter is issued.'
          : 'The suspension letter remains a draft.',
      })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Could not save suspension request',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Prepare Suspension</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Period start</Label>
              <DateInput value={periodStart} onChange={setPeriodStart} />
            </div>
            <div>
              <Label>Period end</Label>
              <DateInput value={periodEnd} onChange={setPeriodEnd} />
            </div>
          </div>
          <div>
            <Label>Inquiry deadline</Label>
            <DateInput
              value={inquiryDeadlineAt}
              onChange={setInquiryDeadlineAt}
            />
          </div>
          <div>
            <Label>Inquiry officer</Label>
            <Select
              value={inquiryOfficerUserId}
              onValueChange={setInquiryOfficerUserId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select officer" />
              </SelectTrigger>
              <SelectContent>
                {officers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.displayName} ({ROLE_LABELS[user.role] ?? user.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Approver</Label>
            <Select
              value={selectedApproverUserId}
              onValueChange={setSelectedApproverUserId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select approver" />
              </SelectTrigger>
              <SelectContent>
                {approvers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.displayName} (
                    {ROLE_LABELS[user.eligibleRole] ?? user.eligibleRole})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={prepareMutation.isPending}
            onClick={() => prepareMutation.mutate(false)}
          >
            Save draft
          </Button>
          <Button
            type="button"
            disabled={prepareMutation.isPending}
            onClick={() => prepareMutation.mutate(true)}
          >
            Submit for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
