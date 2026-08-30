import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { disciplinaryApi } from '@/api/endpoints/disciplinary'
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
import type { Inquiry } from '@/types'

function personLabel(user?: {
  email?: string
  employee?: { fullName: string } | null
} | null) {
  if (!user) return '—'
  return user.employee?.fullName ?? user.email ?? '—'
}

export function PendingInquiryOpenApprovalsCard() {
  const { hasRole } = useAuth()
  const canReview = hasRole([
    'FOUNDER',
    'PRESIDENT',
    'CHAIRMAN',
    'ADMIN_MANAGER',
  ])
  const queryClient = useQueryClient()
  const [review, setReview] = useState<Inquiry | null>(null)
  const [note, setNote] = useState('')
  const [rejectReason, setRejectReason] = useState('')

  const { data: pending = [] } = useQuery({
    queryKey: ['disciplinary', 'inquiry-open-approvals', 'my-pending'],
    queryFn: () => disciplinaryApi.listMyPendingOpenApprovals(),
    enabled: canReview,
  })

  const closeReview = () => {
    setReview(null)
    setNote('')
    setRejectReason('')
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
    queryClient.invalidateQueries({ queryKey: ['employees'] })
  }

  const approveMutation = useMutation({
    mutationFn: () =>
      disciplinaryApi.approveInquiryOpen(review!.id, note || undefined),
    onSuccess: () => {
      toast({
        title: 'Inquiry opened',
        description:
          'Employee is now SUSPENDED. The inquiry officer was notified on WhatsApp.',
      })
      invalidate()
      closeReview()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Could not approve',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? ''),
        variant: 'destructive',
      })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: () =>
      disciplinaryApi.rejectInquiryOpen(review!.id, rejectReason),
    onSuccess: () => {
      toast({
        title: 'Opening rejected',
        description: 'Employee stays ACTIVE. HR can submit again.',
      })
      invalidate()
      closeReview()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Could not reject',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? ''),
        variant: 'destructive',
      })
    },
  })

  if (!canReview || pending.length === 0) return null

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending inquiry openings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Officer</TableHead>
                <TableHead>Days</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <EmployeeNameLink employee={item.disciplinaryAction?.employee} />
                  </TableCell>
                  <TableCell>{personLabel(item.inquiryOfficer)}</TableCell>
                  <TableCell>{item.durationDays ?? '—'}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setReview(item)}>
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!review} onOpenChange={(v) => !v && closeReview()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve inquiry opening</DialogTitle>
          </DialogHeader>
          {review && (
            <div className="space-y-3 text-sm">
              <p>
                Employee stays ACTIVE until you approve. After approval they become
                SUSPENDED and the inquiry is Open.
              </p>
              <p>
                Reason:{' '}
                {review.disciplinaryAction?.reason ?? '—'}
              </p>
              <Badge variant="outline">
                {review.durationDays ?? '—'} inquiry days
              </Badge>
              <div className="space-y-1">
                <Label>Note (optional)</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Reject reason</Label>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!rejectReason.trim() || rejectMutation.isPending}
              onClick={() => rejectMutation.mutate()}
            >
              Reject
            </Button>
            <Button
              disabled={approveMutation.isPending}
              onClick={() => approveMutation.mutate()}
            >
              Approve &amp; open inquiry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
