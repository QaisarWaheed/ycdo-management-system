import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Scale } from 'lucide-react'
import {
  disciplinaryApi,
  type InquiryDecisionPending,
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

function personLabel(user?: {
  email?: string
  employee?: { fullName: string } | null
} | null) {
  if (!user) return '—'
  return user.employee?.fullName ?? user.email ?? '—'
}

export function PendingInquiryDecisionsCard() {
  const { hasRole } = useAuth()
  const canReview = hasRole([
    'FOUNDER',
    'PRESIDENT',
    'CHAIRMAN',
    'ADMIN_MANAGER',
  ])
  const queryClient = useQueryClient()
  const [review, setReview] = useState<InquiryDecisionPending | null>(null)
  const [note, setNote] = useState('')
  const [rejectReason, setRejectReason] = useState('')

  const { data: pending = [] } = useQuery({
    queryKey: ['disciplinary', 'inquiry-decisions', 'my-pending'],
    queryFn: () => disciplinaryApi.listMyPendingInquiryDecisions(),
    enabled: canReview,
  })

  const closeReview = () => {
    setReview(null)
    setNote('')
    setRejectReason('')
  }

  const approveMutation = useMutation({
    mutationFn: () =>
      disciplinaryApi.approveInquiryFinalDecision(review!.id, note || undefined),
    onSuccess: () => {
      toast({
        title: 'Inquiry decision approved',
        description:
          'The outcome has been applied. Final letters (if any) are drafts until issued from Letters. No WhatsApp was sent.',
      })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
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
      disciplinaryApi.rejectInquiryFinalDecision(review!.id, rejectReason),
    onSuccess: () => {
      toast({ title: 'Inquiry decision rejected' })
      queryClient.invalidateQueries({ queryKey: ['disciplinary'] })
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

  if (!canReview) return null

  return (
    <>
      <Card className="border-slate-300/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-slate-700" />
            Pending Inquiry Decisions
            <Badge className="ml-2">{pending.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-secondary">
              No inquiry decisions assigned to you
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Finding</TableHead>
                  <TableHead>Final action</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {item.disciplinaryAction?.employee ? (
                        <EmployeeNameLink
                          employee={item.disciplinaryAction.employee}
                        />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{item.finding?.replace(/_/g, ' ') ?? '—'}</TableCell>
                    <TableCell>
                      {item.finding === 'NOT_GUILTY'
                        ? 'Transfer + reinstate'
                        : item.finalAction?.replace(/_/g, ' ') ?? '—'}
                    </TableCell>
                    <TableCell>{personLabel(item.inquiryOfficer)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => setReview(item)}>
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

      <Dialog open={!!review} onOpenChange={(v) => !v && closeReview()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve inquiry decision</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            Approving applies the selected outcome immediately. This cannot be
            undone from this screen.
          </p>
          {review?.finding === 'NOT_GUILTY' && (
            <p className="text-sm font-medium text-amber-800">
              NOT GUILTY — TRANSFER REQUIRED BEFORE REINSTATEMENT
            </p>
          )}
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
          <DialogFooter>
            <Button variant="outline" onClick={closeReview}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rejectReason.trim().length < 3 || rejectMutation.isPending}
              onClick={() => rejectMutation.mutate()}
            >
              Reject
            </Button>
            <Button
              disabled={approveMutation.isPending}
              onClick={() => approveMutation.mutate()}
            >
              Approve and apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
