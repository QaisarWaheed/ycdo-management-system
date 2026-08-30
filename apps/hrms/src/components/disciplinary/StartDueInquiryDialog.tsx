import { useEffect, useMemo, useState } from 'react'
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
  const [officerName, setOfficerName] = useState('')
  const [officerDesignation, setOfficerDesignation] = useState('')
  const [officerPhone, setOfficerPhone] = useState('')
  const [approverId, setApproverId] = useState('')
  const [approverWhatsApp, setApproverWhatsApp] = useState('')

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
  const approver = useMemo(
    () => approvers.find((row) => row.id === approverId),
    [approvers, approverId],
  )

  const days = Math.min(30, Math.max(1, Number(durationDays) || 1))
  const startDate = new Date()
  const endDate = addDays(startDate, days)
  const detailsReady =
    !!preview &&
    officerName.trim().length > 1 &&
    officerPhone.trim().length >= 10

  const reset = () => {
    setStep('details')
    setDurationDays('3')
    setOfficerId('')
    setOfficerName('')
    setOfficerDesignation('')
    setOfficerPhone('')
    setApproverId('')
    setApproverWhatsApp('')
  }

  useEffect(() => {
    if (!officer) return
    setOfficerName(officer.displayName)
    setOfficerDesignation(officer.designation ?? '')
    setOfficerPhone(officer.phone ?? '')
  }, [officer])

  useEffect(() => {
    if (!approver) return
    setApproverWhatsApp(approver.phone ?? '')
  }, [approver])

  const submitMutation = useMutation({
    mutationFn: () =>
      attendanceApi.startSuspensionCaseFromWatchlist(employeeId!, {
        durationDays: days,
        inquiryOfficerUserId: officerId || undefined,
        inquiryOfficerName: officerName.trim(),
        inquiryOfficerDesignation: officerDesignation.trim() || undefined,
        inquiryOfficerPhone: officerPhone.trim(),
        selectedApproverUserId: approverId,
        approverWhatsApp: approverWhatsApp.trim(),
      }),
    onSuccess: () => {
      toast({
        title: 'Inquiry sent for approval',
        description:
          'The employee stays ACTIVE. WhatsApp went to the inquiry officer and the selected authority.',
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
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
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
              Status stays ACTIVE until this inquiry is approved and officially
              opened. The inquiry itself is physical / offline.
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
                Clock starts when approved · expected end{' '}
                {format(endDate, 'dd/MM/yyyy')} (from {format(startDate, 'dd/MM/yyyy')})
              </p>
            </div>
            <div className="space-y-1">
              <Label>Fill officer from HRMS user (optional)</Label>
              <Select
                value={officerId}
                onValueChange={(value) => setOfficerId(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Skip if the officer is not in the user list" />
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
              <Label>Inquiry officer name *</Label>
              <Input
                value={officerName}
                onChange={(e) => setOfficerName(e.target.value)}
                placeholder="Name as it should appear / WhatsApp greeting"
              />
            </div>
            <div className="space-y-1">
              <Label>Inquiry officer designation</Label>
              <Input
                value={officerDesignation}
                onChange={(e) => setOfficerDesignation(e.target.value)}
                placeholder="e.g. Chairman Admin"
              />
            </div>
            <div className="space-y-1">
              <Label>Inquiry officer WhatsApp *</Label>
              <Input
                value={officerPhone}
                onChange={(e) => setOfficerPhone(e.target.value)}
                placeholder="03XXXXXXXXX"
              />
            </div>
            <div className="space-y-1">
              <Label>Reason for inquiry</Label>
              <Textarea value={preview?.reason ?? ''} readOnly rows={4} />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Select Founder, Chairman Admin, or President. Enter their WhatsApp
              number so the approval request can be sent even if the profile
              phone is missing.
            </p>
            <div className="space-y-1">
              <Label>Approving authority</Label>
              <Select
                value={approverId}
                onValueChange={(value) => setApproverId(value)}
              >
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
            <div className="space-y-1">
              <Label>Approver WhatsApp *</Label>
              <Input
                value={approverWhatsApp}
                onChange={(e) => setApproverWhatsApp(e.target.value)}
                placeholder="03XXXXXXXXX"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'details' ? (
            <Button disabled={!detailsReady} onClick={() => setStep('approver')}>
              Continue
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('details')}>
                Back
              </Button>
              <Button
                disabled={
                  !approverId ||
                  approverWhatsApp.trim().length < 10 ||
                  submitMutation.isPending
                }
                onClick={() => submitMutation.mutate()}
              >
                {submitMutation.isPending ? 'Submitting…' : 'Send for approval'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
