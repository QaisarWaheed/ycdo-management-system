import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Gavel } from 'lucide-react'
import {
  disciplinaryApi,
  type SuspensionApprovalRequest,
} from '@/api/endpoints/disciplinary'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { formatBranchLabel } from '@/lib/formatBranchLabel'

function personLabel(user?: {
  email: string
  employee?: { fullName: string } | null
} | null) {
  if (!user) return '—'
  return user.employee?.fullName ?? user.email
}

export function PendingSuspensionApprovalsCard() {
  const { hasRole } = useAuth()
  const canReview = hasRole([
    'FOUNDER',
    'PRESIDENT',
    'CHAIRMAN',
    'ADMIN_MANAGER',
  ])
  const queryClient = useQueryClient()
  const [review, setReview] = useState<SuspensionApprovalRequest | null>(null)
  const [note, setNote] = useState('')
  const [rejectReason, setRejectReason] = useState('')

  const { data: pending = [] } = useQuery({
    queryKey: ['disciplinary', 'suspension-approvals', 'my-pending'],
    queryFn: () => disciplinaryApi.listMyPendingApprovals(),
    enabled: canReview,
  })

  const closeReview = () => {
    setReview(null)
    setNote('')
    setRejectReason('')
  }

  const approveMutation = useMutation({
    mutationFn: () =>
      disciplinaryApi.approveSuspensionRequest(review!.id, note || undefined),
    onSuccess: () => {
      toast({
        title: 'Suspension approved',
        description:
          'The employee is not suspended yet. HR still has to issue the letter.',
      })
      queryClient.invalidateQueries({
        queryKey: ['disciplinary', 'suspension-approvals', 'my-pending'],
      })
      closeReview()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Could not approve',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: () =>
      disciplinaryApi.rejectSuspensionRequest(review!.id, rejectReason),
    onSuccess: () => {
      toast({ title: 'Suspension request rejected' })
      queryClient.invalidateQueries({
        queryKey: ['disciplinary', 'suspension-approvals', 'my-pending'],
      })
      closeReview()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Could not reject',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const openPdf = async () => {
    if (!review) return
    try {
      const blob = await disciplinaryApi.getAssignedApprovalLetterPdf(review.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      toast({
        title: 'Could not open letter PDF',
        variant: 'destructive',
      })
    }
  }

  if (!canReview) return null

  return (
    <>
      <Card className="border-amber-300/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gavel className="h-5 w-5 text-amber-700" />
            Pending Suspension Requests
            <Badge className="ml-2">{pending.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-secondary">
              No suspension requests assigned to you
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Inquiry officer</TableHead>
                  <TableHead>Inquiry deadline</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {item.employee ? (
                        <div>
                          <EmployeeNameLink employee={item.employee} />
                          <p className="font-mono text-xs text-text-secondary">
                            {item.employee.employeeCode}
                          </p>
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {formatBranchLabel(item.employee?.currentBranch)}
                    </TableCell>
                    <TableCell>
                      {format(new Date(item.periodStart), 'dd/MM/yyyy')} –{' '}
                      {format(new Date(item.periodEnd), 'dd/MM/yyyy')}
                      {item.durationDays != null
                        ? ` (${item.durationDays}d)`
                        : ''}
                    </TableCell>
                    <TableCell>{personLabel(item.inquiryOfficer)}</TableCell>
                    <TableCell>
                      {format(new Date(item.inquiryDeadlineAt), 'dd/MM/yyyy')}
                    </TableCell>
                    <TableCell>
                      <div>
                        {personLabel(item.submittedBy)}
                        <p className="text-xs text-text-secondary">
                          {item.submittedAt
                            ? format(new Date(item.submittedAt), 'dd/MM/yyyy')
                            : '—'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setReview(item)}
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!review} onOpenChange={(open) => !open && closeReview()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Review suspension request</DialogTitle>
          </DialogHeader>
          {review && (
            <div className="space-y-3 text-sm">
              <p>
                <span className="font-medium">Employee: </span>
                {review.employee?.fullName} ({review.employee?.employeeCode})
              </p>
              <p>
                <span className="font-medium">Branch: </span>
                {formatBranchLabel(review.employee?.currentBranch)}
              </p>
              <p>
                <span className="font-medium">Reason: </span>
                {review.reason}
              </p>
              <p>
                <span className="font-medium">Period: </span>
                {format(new Date(review.periodStart), 'dd/MM/yyyy')} –{' '}
                {format(new Date(review.periodEnd), 'dd/MM/yyyy')}
              </p>
              <p>
                <span className="font-medium">Inquiry officer: </span>
                {personLabel(review.inquiryOfficer)}
              </p>
              <p>
                <span className="font-medium">Inquiry deadline: </span>
                {format(new Date(review.inquiryDeadlineAt), 'dd/MM/yyyy')}
              </p>
              <p>
                <span className="font-medium">Case: </span>
                {review.disciplinaryAction?.type} ·{' '}
                {review.disciplinaryAction?.status}
              </p>
              <p>
                <span className="font-medium">Letter: </span>
                {review.letter?.letterNo ?? review.letter?.id} (
                {review.letter?.status})
              </p>
              <Button type="button" variant="outline" size="sm" onClick={openPdf}>
                Open draft letter PDF
              </Button>
              <div>
                <Label>Approval note (optional)</Label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />
              </div>
              <div>
                <Label>Rejection reason</Label>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              disabled={rejectMutation.isPending || approveMutation.isPending}
              onClick={() => rejectMutation.mutate()}
            >
              Reject
            </Button>
            <Button
              type="button"
              disabled={approveMutation.isPending || rejectMutation.isPending}
              onClick={() => approveMutation.mutate()}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
