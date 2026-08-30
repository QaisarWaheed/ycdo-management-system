import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, format } from 'date-fns'
import { attendanceApi } from '@/api/endpoints/attendance'
import { disciplinaryApi } from '@/api/endpoints/disciplinary'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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
import { getApiErrorMessage } from '@/lib/apiErrorMessage'

export function StartDueInquiryDialog({
  employeeId,
  open,
  onOpenChange,
}: {
  employeeId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'details' | 'approver'>('details')
  const [durationDays, setDurationDays] = useState('3')
  const [officerId, setOfficerId] = useState('')
  const [approverId, setApproverId] = useState('')

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['due-inquiry-preview', employeeId],
    queryFn: () => attendanceApi.getDueInquiryPreview(employeeId!),
    enabled: open && !!employeeId,
  })
  const { data: officers = [] } = useQuery({
    queryKey: ['inquiry-officers'],
    queryFn: () => disciplinaryApi.listInquiryOfficers(),
    enabled: open,
  })
  const { data: approvers = [] } = useQuery({
    queryKey: ['suspension-approvers'],
    queryFn: () => disciplinaryApi.listEligibleApprovers(),
    enabled: open && step === 'approver',
  })

  const officer = useMemo(
    () => officers.find((row) => row.id === officerId),
    [officers, officerId],
  )

  const days = Math.min(30, Math.max(1, Number(durationDays) || 1))
  const startDate = new Date()
  const endDate = addDays(startDate, days)

  const reset = () => {
    setStep('details')
    setDurationDays('3')
    setOfficerId('')
    setApproverId('')
  }

  const submitMutation = useMutation({
    mutationFn: () =>
      attendanceApi.startSuspensionCaseFromWatchlist(employeeId!, {
        durationDays: days,
        inquiryOfficerUserId: officerId,
        selectedApproverUserId: approverId,
      }),
    onSuccess: () => {
      toast({
        title: 'Inquiry sent for approval',
        description:
          'The employee stays ACTIVE until the selected authority approves opening the inquiry.',
      })
      queryClient.invalidateQueries({ queryKey: ['suspension-watchlist'] })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
      queryClient.invalidateQueries({
        queryKey: ['disciplinary', 'inquiry-open-approvals'],
      })
      reset()
      onOpenChange(false)
    },
    onError: (err: unknown) => {
      toast({
        title: 'Could not start inquiry',
        description: getApiErrorMessage(err, 'Request failed'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === 'details' ? 'Start inquiry' : 'Whose approval is required?'}
          </DialogTitle>
        </DialogHeader>

        {previewLoading ? (
          <p className="text-sm text-text-secondary">Loading details…</p>
        ) : step === 'details' ? (
          <div className="space-y-3">
            <p className="text-sm">
              Employee:{' '}
              <strong>
                {preview?.fullName}
                {preview?.employeeCode ? ` (${preview.employeeCode})` : ''}
              </strong>
            </p>
            <p className="text-xs text-text-secondary">
              Status stays ACTIVE until this inquiry is approved and officially opened.
            </p>
            <div className="space-y-1">
              <Label>Number of inquiry days</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
              />
              <p className="text-xs text-text-secondary">
                Start {format(startDate, 'dd/MM/yyyy')} · End{' '}
                {format(endDate, 'dd/MM/yyyy')} (starts when approved)
              </p>
            </div>
            <div className="space-y-1">
              <Label>Inquiry officer</Label>
              <Select value={officerId} onValueChange={setOfficerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select officer" />
                </SelectTrigger>
                <SelectContent>
                  {officers.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.displayName}
                      {row.employeeCode ? ` (${row.employeeCode})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Inquiry officer designation</Label>
              <Input value={officer?.designation ?? '—'} readOnly />
            </div>
            <div className="space-y-1">
              <Label>Inquiry officer WhatsApp</Label>
              <Input value={officer?.phone ?? '—'} readOnly />
            </div>
            <div className="space-y-1">
              <Label>Reason for inquiry</Label>
              <Textarea value={preview?.reason ?? ''} readOnly rows={4} />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              A WhatsApp approval request will be sent to the selected authority,
              same pattern as appointment approval.
            </p>
            <div className="space-y-1">
              <Label>Approving authority</Label>
              <Select value={approverId} onValueChange={setApproverId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Founder, Chairman, President…" />
                </SelectTrigger>
                <SelectContent>
                  {approvers.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.displayName} · {row.eligibleRole.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'details' ? (
            <Button
              disabled={!officerId || !preview}
              onClick={() => setStep('approver')}
            >
              Continue
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('details')}>
                Back
              </Button>
              <Button
                disabled={!approverId || submitMutation.isPending}
                onClick={() => submitMutation.mutate()}
              >
                {submitMutation.isPending ? 'Submitting…' : 'Start inquiry'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
