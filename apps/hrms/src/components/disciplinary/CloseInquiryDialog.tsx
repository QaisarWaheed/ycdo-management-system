import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { branchesApi } from '@/api/endpoints/branches'
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
import type { Inquiry } from '@/types'

export function CloseInquiryDialog({
  inquiry,
  open,
  onOpenChange,
}: {
  inquiry: Inquiry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const legacy = !inquiry?.inquiryOfficerUserId
  const [finding, setFinding] = useState<'GUILTY' | 'NOT_GUILTY'>('NOT_GUILTY')
  const [notes, setNotes] = useState('')
  const [recommendation, setRecommendation] = useState('')
  const [finalAction, setFinalAction] = useState('DISMISS')
  const [destinationBranchId, setDestinationBranchId] = useState('')
  const [fineAmount, setFineAmount] = useState('')
  const [approverId, setApproverId] = useState('')

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
    enabled: open,
  })
  const { data: approvers = [] } = useQuery({
    queryKey: ['suspension-approvers'],
    queryFn: () => disciplinaryApi.listEligibleApprovers(),
    enabled: open && !legacy,
  })

  useEffect(() => {
    if (!open || !inquiry) return
    setFinding(inquiry.finding ?? 'NOT_GUILTY')
    setNotes(inquiry.notes ?? '')
    setRecommendation(inquiry.closeRecommendation ?? '')
    setFinalAction(inquiry.finalAction ?? 'DISMISS')
    setDestinationBranchId(inquiry.destinationBranchId ?? '')
    setFineAmount(inquiry.fineAmount != null ? String(inquiry.fineAmount) : '')
    setApproverId('')
  }, [open, inquiry])

  const needsDutyBranch = finding === 'NOT_GUILTY' || finalAction === 'FINE_AND_REINSTATE'

  const submitMutation = useMutation({
    mutationFn: () =>
      disciplinaryApi.closeInquiry(inquiry!.id, {
        finding,
        notes,
        closeRecommendation: recommendation,
        selectedApproverUserId: legacy ? undefined : approverId,
        destinationBranchId: needsDutyBranch ? destinationBranchId : undefined,
        finalAction: finding === 'GUILTY' ? finalAction : undefined,
        fineAmount:
          finding === 'GUILTY' && finalAction === 'FINE_AND_REINSTATE'
            ? Number(fineAmount)
            : undefined,
      }),
    onSuccess: () => {
      toast({
        title: legacy ? 'Inquiry closed (automatic approval)' : 'Inquiry result submitted',
        description: legacy
          ? 'No inquiry officer was assigned, so the selected action was applied.'
          : 'Inquiry officer was notified in Urdu. Final approver must approve before the employee status changes.',
      })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      onOpenChange(false)
    },
    onError: (err: unknown) => {
      toast({
        title: 'Could not close inquiry',
        description: getApiErrorMessage(err, 'Request failed'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Close inquiry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {legacy ? (
            <p className="text-xs text-amber-800">
              Legacy record: no inquiry officer assigned. HR can complete this
              with automatic approval.
            </p>
          ) : (
            <p className="text-xs text-text-secondary">
              Physical inquiry is complete. Fill the result, then send for final
              approval. The inquiry officer will receive a Urdu WhatsApp summary.
            </p>
          )}
          <div className="space-y-1">
            <Label>Finding</Label>
            <Select
              value={finding}
              onValueChange={(v) => setFinding(v as 'GUILTY' | 'NOT_GUILTY')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NOT_GUILTY">Not guilty — reinstate / continue duties</SelectItem>
                <SelectItem value="GUILTY">Guilty</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Inquiry result / notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1">
            <Label>Recommendation</Label>
            <Textarea
              value={recommendation}
              onChange={(e) => setRecommendation(e.target.value)}
              rows={3}
            />
          </div>
          {finding === 'GUILTY' && (
            <div className="space-y-1">
              <Label>Required action (applied to employee after approval)</Label>
              <Select value={finalAction} onValueChange={setFinalAction}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DISMISS">Dismissed</SelectItem>
                  <SelectItem value="TERMINATE">Terminated</SelectItem>
                  <SelectItem value="REST">On rest</SelectItem>
                  <SelectItem value="FINE_AND_REINSTATE">Fine and reinstate (Active)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {needsDutyBranch && (
            <div className="space-y-1">
              <Label>Duty branch</Label>
              <Select
                value={destinationBranchId}
                onValueChange={setDestinationBranchId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b: { id: string; name: string }) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {finding === 'GUILTY' && finalAction === 'FINE_AND_REINSTATE' && (
            <div className="space-y-1">
              <Label>Fine amount</Label>
              <Input
                type="number"
                min={1}
                value={fineAmount}
                onChange={(e) => setFineAmount(e.target.value)}
              />
            </div>
          )}
          {!legacy && (
            <div className="space-y-1">
              <Label>Final approving authority</Label>
              <Select value={approverId} onValueChange={setApproverId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select approver" />
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
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={
              submitMutation.isPending ||
              (!legacy && !approverId) ||
              (needsDutyBranch && !destinationBranchId)
            }
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending
              ? 'Submitting…'
              : legacy
                ? 'Close and apply'
                : 'Submit for approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
