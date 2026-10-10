import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { attendanceLocksApi, payrollFinalizeApi } from '@/api/endpoints/attendanceLocks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { formatPKR } from '@/lib/stipendUtils'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

/** Accounts (Finalize payroll permission) mark entries Processed / Paid. */
export function useCanFinalizePayroll() {
  const { hasPermission, hasRole } = useAuth()
  return hasPermission('PAYROLL_FINALIZE') || hasRole(['SUPER_ADMIN'])
}

/** Finalise a whole branch month: Processed (verified attendance only) or Paid. */
export function PayrollFinalizeDialog({
  month,
  year,
  defaultBranchId,
  onClose,
}: {
  month: number
  year: number
  defaultBranchId?: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [branchId, setBranchId] = useState(defaultBranchId ?? '')
  const [result, setResult] = useState<{
    total: number
    done: number
    failed: Array<{ employee: string; error: string }>
  } | null>(null)
  const { data } = useQuery({
    queryKey: ['attendance-locks', year, month],
    queryFn: () => attendanceLocksApi.list(year, month),
  })
  const branch = data?.branches.find((b) => b.id === branchId)
  const verified = branch?.status === 'VERIFIED'

  const mutation = useMutation({
    mutationFn: (status: 'PROCESSED' | 'PAID') =>
      payrollFinalizeApi.finalize({ branchId, month, year, status }),
    onSuccess: (res) => {
      setResult(res)
      toast({ title: `${res.done} of ${res.total} entries updated` })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (err: ApiError) =>
      toast({ title: 'Could not finalise', description: errText(err), variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Finalise payroll — {format(new Date(year, month - 1), 'MMMM yyyy')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <Label>Branch</Label>
            <Select
              value={branchId}
              onValueChange={(v) => {
                setBranchId(v)
                setResult(null)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a branch" />
              </SelectTrigger>
              <SelectContent>
                {(data?.branches ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} {b.status === 'VERIFIED' ? '✓' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {branch ? (
            verified ? (
              <p>
                <Badge className="bg-green-600 hover:bg-green-600">Attendance verified</Badge> by{' '}
                {branch.verifiedBy}
              </p>
            ) : (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
                HR has not verified this branch&apos;s attendance for the month yet. Entries can be
                marked Processed after HR verifies it (Attendance → Verify Month).
              </p>
            )
          ) : null}
          <p className="text-muted-foreground">
            Processed moves every Pending entry of the branch; Paid moves every Processed entry.
          </p>
          {result ? (
            <div className="rounded-md border p-2">
              <p className="font-medium">
                {result.done} of {result.total} updated
              </p>
              {result.failed.map((f) => (
                <p key={f.employee} className="text-xs text-destructive">
                  {f.employee}: {f.error}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="outline"
            disabled={!branchId || mutation.isPending}
            onClick={() => mutation.mutate('PAID')}
          >
            Mark Paid
          </Button>
          <Button
            disabled={!branchId || !verified || mutation.isPending}
            onClick={() => mutation.mutate('PROCESSED')}
          >
            Mark Processed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Change history of one payroll entry (who, when, net before → after). */
export function PayrollChangeHistory({ entryId }: { entryId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['payroll', 'changes', entryId],
    queryFn: () => payrollFinalizeApi.changes(entryId),
  })
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
  }
  return (
    <ul className="space-y-2">
      {data.map((c) => (
        <li key={c.id} className="rounded-md border p-2 text-sm">
          <div className="font-medium">{c.summary}</div>
          <div className="text-xs text-muted-foreground">
            {format(new Date(c.createdAt), 'dd MMM yyyy, h:mm a')} ·{' '}
            {c.user ? (c.user.employee?.fullName ?? c.user.email) : 'Automatic'}
            {c.netBefore != null &&
            c.netAfter != null &&
            Number(c.netBefore) !== Number(c.netAfter)
              ? ` · Net ${formatPKR(Number(c.netBefore))} → ${formatPKR(Number(c.netAfter))}`
              : ''}
          </div>
        </li>
      ))}
    </ul>
  )
}
