import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { attendanceLocksApi, type BranchMonthLock } from '@/api/endpoints/attendanceLocks'
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
import { Input } from '@/components/ui/input'
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

const lastMonth = () => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const when = (iso: string | null) => (iso ? format(new Date(iso), 'dd MMM yyyy, h:mm a') : '')

/** HR verifies (locks) each branch's month of attendance; IT unlocks with a reason. */
export function AttendanceMonthLockTab() {
  const { hasPermission, hasRole } = useAuth()
  const canVerify = hasPermission('ATTENDANCE_VERIFY') || hasRole(['SUPER_ADMIN'])
  const canUnlock = hasRole(['IT_ADMIN', 'SUPER_ADMIN'])
  const queryClient = useQueryClient()
  const [monthValue, setMonthValue] = useState(lastMonth())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [unlocking, setUnlocking] = useState<BranchMonthLock | null>(null)
  const [year, month] = monthValue.split('-').map(Number)

  const { data, isLoading } = useQuery({
    queryKey: ['attendance-locks', year, month],
    queryFn: () => attendanceLocksApi.list(year, month),
    enabled: !!year && !!month,
  })

  const verify = useMutation({
    mutationFn: () => attendanceLocksApi.verify([...selected], year, month),
    onSuccess: (res) => {
      toast({ title: `Verified ${selected.size} branch(es)` })
      queryClient.setQueryData(['attendance-locks', year, month], res)
      setSelected(new Set())
    },
    onError: (err: ApiError) =>
      toast({ title: 'Could not verify', description: errText(err), variant: 'destructive' }),
  })

  const open = (data?.branches ?? []).filter((b) => b.status !== 'VERIFIED')
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Label htmlFor="lock-month">Month</Label>
          <Input
            id="lock-month"
            type="month"
            value={monthValue}
            onChange={(e) => {
              setMonthValue(e.target.value)
              setSelected(new Set())
            }}
            className="w-44"
          />
        </div>
        {canVerify ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!data?.canVerify || open.length === 0}
              onClick={() => setSelected(new Set(open.map((b) => b.id)))}
            >
              Select all unverified
            </Button>
            <Button
              disabled={!data?.canVerify || selected.size === 0 || verify.isPending}
              onClick={() => verify.mutate()}
            >
              Verify &amp; lock ({selected.size})
            </Button>
          </div>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Once verified, attendance for that branch and month is locked and Accounts can finalise
        payroll.{' '}
        {data && !data.canVerify ? 'This month is not over yet, so it cannot be verified.' : ''}
      </p>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {canVerify ? <TableHead className="w-10" /> : null}
                <TableHead>Branch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Details</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">Loading…</TableCell>
                </TableRow>
              ) : (
                (data?.branches ?? []).map((b) => (
                  <TableRow key={b.id}>
                    {canVerify ? (
                      <TableCell>
                        {b.status !== 'VERIFIED' && data?.canVerify ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${b.name}`}
                            checked={selected.has(b.id)}
                            onChange={() => toggle(b.id)}
                          />
                        ) : null}
                      </TableCell>
                    ) : null}
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell>
                      {b.status === 'VERIFIED' ? (
                        <Badge className="bg-green-600 hover:bg-green-600">Verified · locked</Badge>
                      ) : b.status === 'UNLOCKED' ? (
                        <Badge variant="outline" className="border-amber-500 text-amber-700">
                          Unlocked
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Not verified</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {b.status === 'VERIFIED'
                        ? `by ${b.verifiedBy ?? '—'} · ${when(b.verifiedAt)}`
                        : b.status === 'UNLOCKED'
                          ? `by ${b.unlockedBy ?? '—'} · ${when(b.unlockedAt)} — ${b.unlockReason ?? ''}`
                          : ''}
                    </TableCell>
                    <TableCell className="text-right">
                      {b.status === 'VERIFIED' && canUnlock ? (
                        <Button size="sm" variant="outline" onClick={() => setUnlocking(b)}>
                          Unlock
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {unlocking ? (
        <UnlockDialog
          branch={unlocking}
          year={year}
          month={month}
          onClose={() => setUnlocking(null)}
        />
      ) : null}
    </div>
  )
}

function UnlockDialog({
  branch,
  year,
  month,
  onClose,
}: {
  branch: BranchMonthLock
  year: number
  month: number
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const mutation = useMutation({
    mutationFn: () => attendanceLocksApi.unlock(branch.id, year, month, reason.trim()),
    onSuccess: (res) => {
      toast({ title: `${branch.name} unlocked` })
      queryClient.setQueryData(['attendance-locks', year, month], res)
      onClose()
    },
    onError: (err: ApiError) =>
      toast({ title: 'Could not unlock', description: errText(err), variant: 'destructive' }),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Unlock {branch.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>
            HR can correct attendance again and must verify the month once more before Accounts can
            finalise payroll.
          </p>
          <Label htmlFor="unlock-reason">Reason</Label>
          <Textarea id="unlock-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={reason.trim().length < 5 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Unlock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
