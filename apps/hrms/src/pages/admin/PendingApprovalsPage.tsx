import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  APPROVER_OPTIONS,
  employeeOnboardingApi,
  type EmployeeApproverTarget,
  type EmployeeOnboardingApproval,
} from '@/api/endpoints/employeeOnboarding'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

const approverLabel = (target: EmployeeApproverTarget) =>
  APPROVER_OPTIONS.find((o) => o.value === target)?.label ?? target

/** IT view of every pending new-employee approval, with re-routing. */
export function PendingApprovalsPage() {
  const [forwarding, setForwarding] = useState<EmployeeOnboardingApproval | null>(null)
  const { data = [], isLoading } = useQuery({
    queryKey: ['onboarding-approvals', 'PENDING'],
    queryFn: () => employeeOnboardingApi.list('PENDING'),
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Pending Approvals</h1>
        <p className="text-sm text-muted-foreground">
          New employee approvals waiting with President, Founder or Chairman Admin.
          Forward one if the current approver is not available.
        </p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Branch / Department</TableHead>
                <TableHead>Sent by</TableHead>
                <TableHead>Sent on</TableHead>
                <TableHead>Waiting with</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">Loading…</TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">No pending approvals</TableCell>
                </TableRow>
              ) : (
                data.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-medium">{a.employee?.fullName ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.employee?.employeeCode}
                        {a.employee?.currentDesignation ? ` · ${a.employee.currentDesignation}` : ''}
                      </div>
                    </TableCell>
                    <TableCell>
                      {a.employee?.currentBranch?.name ?? '—'}
                      {a.employee?.currentDepartment?.name
                        ? ` / ${a.employee.currentDepartment.name}`
                        : ''}
                    </TableCell>
                    <TableCell>
                      {a.submittedBy?.employee?.fullName ?? a.submittedBy?.email ?? '—'}
                    </TableCell>
                    <TableCell>{format(new Date(a.createdAt), 'dd MMM yyyy, h:mm a')}</TableCell>
                    <TableCell className="font-semibold">{approverLabel(a.approverTarget)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setForwarding(a)}>
                        Forward
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {forwarding ? (
        <ForwardDialog approval={forwarding} onClose={() => setForwarding(null)} />
      ) : null}
    </div>
  )
}

function ForwardDialog({
  approval,
  onClose,
}: {
  approval: EmployeeOnboardingApproval
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const options = APPROVER_OPTIONS.filter((o) => o.value !== approval.approverTarget)
  const [target, setTarget] = useState<EmployeeApproverTarget>(options[0].value)
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: () => employeeOnboardingApi.forward(approval.id, target, reason.trim()),
    onSuccess: () => {
      toast({ title: `Forwarded to ${approverLabel(target)}` })
      queryClient.invalidateQueries({ queryKey: ['onboarding-approvals'] })
      onClose()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to forward',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Forward approval — {approval.employee?.fullName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm">
            Currently waiting with <b>{approverLabel(approval.approverTarget)}</b>.
          </p>
          <div className="space-y-1">
            <Label>Forward to</Label>
            <Select value={target} onValueChange={(v) => setTarget(v as EmployeeApproverTarget)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="forward-reason">Reason</Label>
            <Textarea
              id="forward-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Founder is travelling this week"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={reason.trim().length < 5 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Forward
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
