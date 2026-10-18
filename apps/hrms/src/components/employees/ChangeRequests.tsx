import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import api from '@/api/axios'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

interface ChangeRequest {
  id: string
  kind: 'TRANSFER' | 'WORKING_HOURS'
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  summary: string
  letterId: string | null
  requestedAt: string
  decidedAt: string | null
  decisionNote: string | null
  employee: { id: string; fullName: string; employeeCode: string | null; currentBranch: { name: string } | null }
}
const KIND = { TRANSFER: 'Transfer', WORKING_HOURS: 'Working hours' }
const APPROVER: Record<ChangeRequest['kind'], string[]> = {
  TRANSFER: ['HR_OPERATIONS_MANAGER', 'SUPER_ADMIN'],
  WORKING_HOURS: ['CHAIRMAN', 'PRESIDENT', 'FOUNDER', 'SUPER_ADMIN'],
}

/**
 * Req 16 / 17: transfer (HR Operations) and working-hours (executives)
 * requests. Without employeeId: pending approvals for the dashboard. With
 * employeeId: the employee's full request / letter / approval history.
 */
export function ChangeRequestsCard({ employeeId }: { employeeId?: string }) {
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const [acting, setActing] = useState<{ r: ChangeRequest; approve: boolean } | null>(null)
  const [note, setNote] = useState('')
  const canDecideAny = hasRole(['HR_OPERATIONS_MANAGER', 'CHAIRMAN', 'PRESIDENT', 'FOUNDER', 'SUPER_ADMIN'])
  const { data = [] } = useQuery({
    queryKey: ['employee-change-requests', employeeId ?? 'pending'],
    queryFn: () =>
      api.get<unknown, ChangeRequest[]>('/employee-change-requests', {
        params: employeeId ? { employeeId } : { status: 'PENDING' },
      }),
    enabled: !!employeeId || canDecideAny,
  })
  const rows = employeeId ? data : data.filter((r) => hasRole(APPROVER[r.kind]))
  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/employee-change-requests/${acting!.r.id}/${acting!.approve ? 'approve' : 'reject'}`, {
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      toast({ title: acting?.approve ? 'Approved — change applied' : 'Rejected — nothing changed' })
      setActing(null)
      setNote('')
      queryClient.invalidateQueries({ queryKey: ['employee-change-requests'] })
      queryClient.invalidateQueries({ queryKey: ['employee'] })
    },
    onError: (err: ApiError) => toast({ title: 'Failed', description: errText(err), variant: 'destructive' }),
  })
  if (!rows.length) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {employeeId ? 'Transfer & working-hours requests' : 'Transfer / working-hours approvals'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium">
                {KIND[r.kind]}
                {!employeeId ? (
                  <>
                    {' · '}
                    <EmployeeNameLink employee={r.employee} />
                  </>
                ) : null}
              </div>
              <div className="text-muted-foreground">{r.summary}</div>
              <div className="text-xs text-muted-foreground">
                Requested {format(new Date(r.requestedAt), 'dd/MM/yyyy')}
                {r.letterId ? ' · draft letter in Letters' : ''}
                {r.decidedAt ? ` · decided ${format(new Date(r.decidedAt), 'dd/MM/yyyy')}` : ''}
                {r.decisionNote ? ` · ${r.decisionNote}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{r.status === 'PENDING' ? 'Waiting for approval' : r.status.toLowerCase()}</Badge>
              {r.status === 'PENDING' && hasRole(APPROVER[r.kind]) ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => setActing({ r, approve: false })}>
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => setActing({ r, approve: true })}>
                    Approve
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
      <Dialog open={!!acting} onOpenChange={(o) => !o && setActing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{acting?.approve ? 'Approve and apply' : 'Reject request'}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{acting?.r.summary}</p>
          <Textarea placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setActing(null)}>
              Cancel
            </Button>
            <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
