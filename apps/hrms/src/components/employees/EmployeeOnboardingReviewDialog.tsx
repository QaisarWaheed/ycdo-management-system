import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Printer, X } from 'lucide-react'
import {
  employeeOnboardingApi,
  type EmployeeOnboardingApproval,
} from '@/api/endpoints/employeeOnboarding'
import { EmployeeInformationForm } from '@/components/employees/EmployeeInformationForm'
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
import { buildEmployeeInformationFormData } from '@/lib/employeeInformationFormData'

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
  const [reviewNote, setReviewNote] = useState('')

  const formData = useMemo(
    () => (approval ? buildEmployeeInformationFormData(approval) : null),
    [approval],
  )

  const approveMutation = useMutation({
    mutationFn: () =>
      employeeOnboardingApi.approve(approval!.id, reviewNote || undefined),
    onSuccess: () => {
      toast({ title: 'Employee approved and activated' })
      queryClient.invalidateQueries({ queryKey: ['employee-onboarding'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      onOpenChange(false)
      setReviewNote('')
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast({
        title: 'Approval failed',
        description: err.response?.data?.message ?? 'Error',
        variant: 'destructive',
      })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: () =>
      employeeOnboardingApi.reject(approval!.id, reviewNote || undefined),
    onSuccess: () => {
      toast({ title: 'Employee request rejected' })
      queryClient.invalidateQueries({ queryKey: ['employee-onboarding'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      onOpenChange(false)
      setReviewNote('')
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast({
        title: 'Rejection failed',
        description: err.response?.data?.message ?? 'Error',
        variant: 'destructive',
      })
    },
  })

  if (!approval || !formData) return null

  const pending = approval.status === 'PENDING'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] max-w-5xl overflow-hidden p-0">
        <div className="no-print border-b px-6 py-4">
          <DialogHeader>
            <DialogTitle>Employee Information Form — Review</DialogTitle>
          </DialogHeader>
          <p className="mt-1 text-sm text-text-secondary">
            Official employee form submitted by HR for your approval.
          </p>
        </div>

        <div className="employee-information-form-print-area max-h-[calc(95vh-180px)] overflow-y-auto bg-gray-100 px-4 py-4 sm:px-6">
          <EmployeeInformationForm
            data={formData}
            showPendingApprover={pending}
            className="shadow-md"
          />
        </div>

        {pending && (
          <div className="no-print space-y-2 border-t px-6 py-3">
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

        {approval.reviewNote && !pending && (
          <p className="no-print px-6 pb-2 text-sm text-text-secondary">
            Note: {approval.reviewNote}
          </p>
        )}

        <DialogFooter className="no-print gap-2 border-t px-6 py-4 sm:gap-0">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print Form
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {pending && (
            <>
              <Button
                variant="outline"
                className="text-red-600 hover:text-red-700"
                disabled={rejectMutation.isPending || approveMutation.isPending}
                onClick={() => rejectMutation.mutate()}
              >
                <X className="mr-2 h-4 w-4" />
                {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
              </Button>
              <Button
                className="bg-primary hover:bg-primary-dark"
                disabled={approveMutation.isPending || rejectMutation.isPending}
                onClick={() => approveMutation.mutate()}
              >
                <Check className="mr-2 h-4 w-4" />
                {approveMutation.isPending ? 'Approving...' : 'Approve'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
