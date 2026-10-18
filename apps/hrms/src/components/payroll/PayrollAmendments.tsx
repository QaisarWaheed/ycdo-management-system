import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/api/axios'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { formatPKR } from '@/lib/stipendUtils'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

interface Amendment {
  id: string
  month: number
  year: number
  status: 'HR_NOTIFIED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'
  notification: string
  financeNote: string | null
  decisionNote: string | null
  payrollEntry: {
    netStipend: string | number
    stipendRecord: {
      employee: { id: string; fullName: string; employeeCode: string | null; currentBranch: { name: string } | null }
    }
  }
}

const STATUS: Record<Amendment['status'], string> = {
  HR_NOTIFIED: 'Waiting for Finance',
  SUBMITTED: 'Waiting for Founder',
  APPROVED: 'Approved — slip open',
  REJECTED: 'Rejected',
}
export const AMENDMENT_HR_ROLES = ['SUPER_ADMIN', 'HR_MANAGER', 'HR_ADMIN_MANAGER', 'HR_OPERATIONS_MANAGER'] as const

/** Req 12: HR's amendment notification for a verified salary slip. */
export function AmendmentNotifyDialog({ entryId, employeeName, onClose }: { entryId: string; employeeName: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const mutation = useMutation({
    mutationFn: () => api.post('/payroll-amendments', { payrollEntryId: entryId, notification: text.trim() }),
    onSuccess: () => {
      toast({ title: 'Amendment notification sent to Finance' })
      queryClient.invalidateQueries({ queryKey: ['payroll-amendments'] })
      onClose()
    },
    onError: (err: ApiError) => toast({ title: 'Failed', description: errText(err), variant: 'destructive' }),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Amendment notification · {employeeName}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This slip is verified by Finance and locked. Write what must change; Finance sends it to the Founder for
          approval.
        </p>
        <Textarea value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="e.g. Uniform fine of 200 was reversed by IT" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={text.trim().length < 5 || mutation.isPending} onClick={() => mutation.mutate()}>
            Send to Finance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Req 12: open amendments. Finance submits HR notifications to the Founder;
 * the Founder approves (slip reopens for Finance) or rejects.
 */
export function PayrollAmendmentsCard() {
  const { hasRole } = useAuth()
  const isFinance = hasRole(['PAYROLL_OFFICER', 'SUPER_ADMIN'])
  const isFounder = hasRole(['FOUNDER', 'SUPER_ADMIN'])
  const canSee = isFinance || isFounder || hasRole([...AMENDMENT_HR_ROLES])
  const queryClient = useQueryClient()
  const [acting, setActing] = useState<{ a: Amendment; kind: 'submit' | 'approve' | 'reject' } | null>(null)
  const [note, setNote] = useState('')
  const { data = [] } = useQuery({
    queryKey: ['payroll-amendments'],
    queryFn: () => api.get<unknown, Amendment[]>('/payroll-amendments'),
    enabled: canSee,
  })
  const open = data.filter((a) => a.status === 'HR_NOTIFIED' || a.status === 'SUBMITTED')
  const mutation = useMutation({
    mutationFn: () => api.post(`/payroll-amendments/${acting!.a.id}/${acting!.kind}`, { note: note.trim() || undefined }),
    onSuccess: () => {
      toast({
        title:
          acting?.kind === 'submit'
            ? 'Sent to the Founder'
            : acting?.kind === 'approve'
              ? 'Approved — Finance can edit the slip, then verify again'
              : 'Rejected — the slip stays unchanged',
      })
      setActing(null)
      setNote('')
      queryClient.invalidateQueries({ queryKey: ['payroll-amendments'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (err: ApiError) => toast({ title: 'Failed', description: errText(err), variant: 'destructive' }),
  })
  if (!canSee || open.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Salary slip amendments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {open.map((a) => {
          const e = a.payrollEntry.stipendRecord.employee
          return (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">
                  <EmployeeNameLink employee={e} /> · {a.month}/{a.year} · net {formatPKR(Number(a.payrollEntry.netStipend))}
                </div>
                <div className="text-muted-foreground">{a.notification}</div>
                {a.financeNote ? <div className="text-xs text-muted-foreground">Finance: {a.financeNote}</div> : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{STATUS[a.status]}</Badge>
                {a.status === 'HR_NOTIFIED' && isFinance ? (
                  <Button size="sm" onClick={() => setActing({ a, kind: 'submit' })}>
                    Submit to Founder
                  </Button>
                ) : null}
                {a.status === 'SUBMITTED' && isFounder ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setActing({ a, kind: 'reject' })}>
                      Reject
                    </Button>
                    <Button size="sm" onClick={() => setActing({ a, kind: 'approve' })}>
                      Approve
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          )
        })}
      </CardContent>
      <Dialog open={!!acting} onOpenChange={(o) => !o && setActing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {acting?.kind === 'submit' ? 'Submit to Founder' : acting?.kind === 'approve' ? 'Approve amendment' : 'Reject amendment'}
            </DialogTitle>
          </DialogHeader>
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
