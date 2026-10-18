import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  EXTRA_TIME_STATUS_LABELS,
  extraTimeApi,
  type PendingExtraTime,
} from '@/api/endpoints/additionalWorkingDays'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

type Action = { approve: boolean; item: PendingExtraTime }

/** HR enters → HR Operations approves → Chairman gives the final approval. A rejection at either level is final. */
export function ExtraTimeApprovalsPage() {
  const { user, hasRole } = useAuth()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<Action | null>(null)
  const [note, setNote] = useState('')

  const { data = [], isLoading } = useQuery({
    queryKey: ['extra-time-pending'],
    queryFn: () => extraTimeApi.pending(),
  })

  const canDecide = (item: PendingExtraTime) =>
    item.requestedById !== user?.id &&
    (hasRole(['SUPER_ADMIN']) ||
      hasRole([item.status === 'ESCALATED' ? 'CHAIRMAN' : 'HR_OPERATIONS_MANAGER']))

  const mutation = useMutation({
    mutationFn: ({ approve, item }: Action) =>
      (approve ? extraTimeApi.approve : extraTimeApi.reject)(
        item.kind,
        item.id,
        note.trim() || undefined,
      ),
    onSuccess: (_res, { approve, item }) => {
      toast({
        title: !approve
          ? 'Rejected (final)'
          : item.status === 'ESCALATED'
            ? 'Approved — salary updated'
            : 'Approved — sent to Chairman for final approval',
      })
      setAction(null)
      setNote('')
      queryClient.invalidateQueries({ queryKey: ['extra-time-pending'] })
      queryClient.invalidateQueries({ queryKey: ['additional-working-days'] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (err: ApiError) =>
      toast({ title: 'Failed', description: errText(err), variant: 'destructive' }),
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Extra Time Approvals</h1>
        <p className="text-sm text-text-secondary">
          Additional working days and overtime entered by HR. They are not paid
          until the Chairman gives the final approval. HR Operations approves first,
          then it goes to the Chairman. A rejection at either level is final.
          Nobody can decide their own entry.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-text-secondary">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-text-secondary">
                    Nothing waiting for approval
                  </TableCell>
                </TableRow>
              ) : (
                data.map((item) => (
                  <TableRow key={`${item.kind}-${item.id}`}>
                    <TableCell>
                      <div className="font-medium">{item.employeeName}</div>
                      <div className="text-xs text-text-secondary">
                        {item.employeeCode}
                      </div>
                    </TableCell>
                    <TableCell>{item.branch ?? '—'}</TableCell>
                    <TableCell>{format(new Date(item.date), 'dd/MM/yyyy')}</TableCell>
                    <TableCell>
                      {item.kind === 'day'
                        ? 'Additional working day'
                        : `Overtime ${Math.round(((item.minutes ?? 0) / 60) * 100) / 100}h (${item.minutes} min)`}
                    </TableCell>
                    <TableCell className="max-w-[240px]">
                      <div className="truncate">{item.note ?? '—'}</div>
                      {item.reviewNote && (
                        <div className="truncate text-xs text-text-secondary">
                          HR Ops: {item.reviewNote}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-text-secondary">
                      {item.requestedBy ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {EXTRA_TIME_STATUS_LABELS[item.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {canDecide(item) ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="bg-primary hover:bg-primary-dark"
                            onClick={() => setAction({ approve: true, item })}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAction({ approve: false, item })}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-text-secondary">
                          {item.requestedById === user?.id
                            ? 'Your entry'
                            : item.status === 'ESCALATED'
                              ? 'Waiting for Chairman'
                              : 'Waiting for HR Operations'}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open) {
            setAction(null)
            setNote('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {!action?.approve
                ? 'Reject (final)'
                : action?.item.status === 'ESCALATED'
                  ? 'Final approval'
                  : 'Approve and send to Chairman'}
            </DialogTitle>
          </DialogHeader>
          {action && (
            <div className="space-y-3">
              <p className="text-sm">
                {action.item.employeeName} ·{' '}
                {format(new Date(action.item.date), 'dd/MM/yyyy')} ·{' '}
                {action.item.kind === 'day'
                  ? 'Additional working day'
                  : `Overtime ${action.item.minutes} min`}
              </p>
              <div className="space-y-1">
                <Label htmlFor="extra-time-note">Note (optional)</Label>
                <Textarea
                  id="extra-time-note"
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              variant={action?.approve ? 'default' : 'destructive'}
              disabled={mutation.isPending}
              onClick={() => action && mutation.mutate(action)}
            >
              {action?.approve ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
