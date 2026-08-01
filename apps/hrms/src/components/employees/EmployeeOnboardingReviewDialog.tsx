import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Printer, X } from 'lucide-react'
import {
  employeeOnboardingApi,
  type EmployeeOnboardingApproval,
} from '@/api/endpoints/employeeOnboarding'
import { EmployeeInformationForm } from '@/components/employees/EmployeeInformationForm'
import { PhysicalFormViewer } from '@/components/employees/PhysicalFormViewer'
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
import { useAuth } from '@/hooks/useAuth'
import { buildEmployeeInformationFormData } from '@/lib/employeeInformationFormData'
import { cn } from '@/lib/utils'

type ReviewTab = 'physical' | 'system'

const EXECUTIVE_ROLES = ['PRESIDENT', 'FOUNDER', 'CHAIRMAN']
const MIN_REASON_LENGTH = 5

export function EmployeeOnboardingReviewDialog({
  approval,
  open,
  onOpenChange,
}: {
  approval: EmployeeOnboardingApproval | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { hasRole } = useAuth()
  const [reviewNote, setReviewNote] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [tab, setTab] = useState<ReviewTab>('physical')

  /** Executives verify the employee record only — routing is HR's concern. */
  const isExecutive = hasRole(EXECUTIVE_ROLES)

  // The list endpoints carry a trimmed record; pull the full one for review.
  const { data: detailed } = useQuery({
    queryKey: ['employee-onboarding', approval?.id],
    queryFn: () => employeeOnboardingApi.getOne(approval!.id),
    enabled: open && !!approval?.id,
  })

  const record = detailed ?? approval

  const formData = useMemo(
    () => (record ? buildEmployeeInformationFormData(record) : null),
    [record],
  )

  const resetState = () => {
    setReviewNote('')
    setRejectReason('')
    setRejecting(false)
    setTab('physical')
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) resetState()
    onOpenChange(next)
  }

  const onReviewed = (title: string) => {
    toast({ title })
    queryClient.invalidateQueries({ queryKey: ['employee-onboarding'] })
    queryClient.invalidateQueries({ queryKey: ['employees'] })
    handleOpenChange(false)
  }

  const onReviewError = (title: string, err: unknown) => {
    const message = (
      err as { response?: { data?: { message?: string | string[] } } }
    ).response?.data?.message
    toast({
      title,
      description: Array.isArray(message)
        ? message.join(', ')
        : (message ?? 'Error'),
      variant: 'destructive',
    })
  }

  const approveMutation = useMutation({
    mutationFn: () =>
      employeeOnboardingApi.approve(
        record!.id,
        isExecutive ? undefined : reviewNote || undefined,
      ),
    onSuccess: () => onReviewed('Employee approved and activated'),
    onError: (err) => onReviewError('Approval failed', err),
  })

  const rejectMutation = useMutation({
    mutationFn: () =>
      employeeOnboardingApi.reject(record!.id, rejectReason.trim()),
    onSuccess: () => onReviewed('Employee request rejected'),
    onError: (err) => onReviewError('Rejection failed', err),
  })

  if (!record || !formData) return null

  const pending = record.status === 'PENDING'
  const busy = approveMutation.isPending || rejectMutation.isPending
  const reasonTooShort = rejectReason.trim().length < MIN_REASON_LENGTH

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex !max-h-[95vh] max-w-5xl !flex-col !gap-0 overflow-hidden p-0">
        <div className="no-print shrink-0 border-b px-6 py-4">
          <DialogHeader>
            <DialogTitle>Verify employee application</DialogTitle>
          </DialogHeader>
          <p className="mt-1 text-sm text-text-secondary">
            Compare the physical filled form with the system-generated
            confirmation. Approve only if both match.
          </p>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                tab === 'physical'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
              )}
              onClick={() => setTab('physical')}
            >
              1. Physical form
            </button>
            <button
              type="button"
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                tab === 'system'
                  ? 'bg-teal-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
              )}
              onClick={() => setTab('system')}
            >
              2. System confirmation
            </button>
          </div>
        </div>

        <div className="employee-information-form-print-area min-h-0 flex-1 overflow-y-auto bg-gray-100 px-4 py-4 sm:px-6">
          {tab === 'physical' ? (
            <PhysicalFormViewer
              url={record.physicalFormUrl}
              mimeType={record.physicalFormMimeType}
              fileName={record.physicalFormFileName}
            />
          ) : (
            <EmployeeInformationForm
              data={formData}
              showPendingApprover={pending && !isExecutive}
              hideApprovalRouting={isExecutive}
              className="shadow-md"
            />
          )}
        </div>

        {pending && !isExecutive && !rejecting && (
          <div className="no-print shrink-0 space-y-2 border-t px-6 py-3">
            <Label htmlFor="reviewNote">Review note (optional)</Label>
            <Textarea
              id="reviewNote"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Add a note for HR..."
              rows={2}
            />
          </div>
        )}

        {pending && rejecting && (
          <div className="no-print shrink-0 space-y-2 border-t bg-red-50/60 px-6 py-3">
            <Label htmlFor="rejectReason">Reason for rejection *</Label>
            <Textarea
              id="rejectReason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain what is wrong so HR can correct it..."
              rows={3}
              autoFocus
            />
            <p className="text-xs text-text-secondary">
              This reason is recorded against the application and shown to HR.
              {reasonTooShort
                ? ` Enter at least ${MIN_REASON_LENGTH} characters to continue.`
                : ''}
            </p>
          </div>
        )}

        {record.reviewNote && !pending && (
          <p className="no-print shrink-0 px-6 py-2 text-sm text-text-secondary">
            Note: {record.reviewNote}
          </p>
        )}

        <DialogFooter className="no-print shrink-0 gap-2 border-t px-6 py-4 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => window.print()}
            disabled={tab !== 'system'}
          >
            <Printer className="mr-2 h-4 w-4" />
            Print system form
          </Button>
          {rejecting ? (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setRejecting(false)
                  setRejectReason('')
                }}
              >
                Cancel
              </Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                disabled={busy || reasonTooShort}
                onClick={() => rejectMutation.mutate()}
              >
                <X className="mr-2 h-4 w-4" />
                {rejectMutation.isPending
                  ? 'Rejecting...'
                  : 'Confirm rejection'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
              {pending && (
                <>
                  <Button
                    className="bg-red-600 text-white hover:bg-red-700"
                    disabled={busy}
                    onClick={() => setRejecting(true)}
                  >
                    <X className="mr-2 h-4 w-4" />
                    Reject
                  </Button>
                  <Button
                    className="bg-primary hover:bg-primary-dark"
                    disabled={busy}
                    onClick={() => approveMutation.mutate()}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    {approveMutation.isPending ? 'Approving...' : 'Approve'}
                  </Button>
                </>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
