import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  attendanceApi,
  type PunchReview,
  type PunchType,
} from '@/api/endpoints/attendance'
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
import { formatPakistanDate, formatPKT } from '@/lib/timeFormat'
import { useAuth } from '@/hooks/useAuth'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

const PK_OFFSET_MS = 5 * 60 * 60 * 1000
const PUNCH_TYPE_LABELS: Record<PunchType, string> = {
  CHECKIN: 'Check-in',
  CHECKOUT: 'Check-out',
  OVERTIME_CHECKIN: 'Overtime check-in',
  OVERTIME_CHECKOUT: 'Overtime check-out',
}

/** ISO → yyyy-MM-ddTHH:mm in Pakistan time (datetime-local value). */
const toPkInput = (iso: string) =>
  new Date(new Date(iso).getTime() + PK_OFFSET_MS).toISOString().slice(0, 16)

const pkDateTime = (iso: string | null) =>
  iso ? `${formatPakistanDate(toPkInput(iso))} ${formatPKT(iso)}` : '—'

const punchLabel = (type: string | null) =>
  PUNCH_TYPE_LABELS[type as PunchType] ?? 'Not known'

type Action = { accept: boolean; item: PunchReview }

/** Super Admin: punches that reached us late but were saved at arrival time. */
function DelayedPunchRepair() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ deviceId: '', date: '', offsetSec: '0' })
  const run = useMutation({
    mutationFn: (apply: boolean) =>
      attendanceApi.repairDelayedPunches({ ...form, offsetSec: Number(form.offsetSec), apply }),
    onSuccess: (res) => {
      if (res.applied) {
        toast({ title: `${res.items.filter((i) => i.result === 'fixed').length} of ${res.count} corrected` })
        queryClient.invalidateQueries({ queryKey: ['attendance'] })
      }
    },
    onError: (err: ApiError) => toast({ title: 'Failed', description: errText(err), variant: 'destructive' }),
  })
  const ready = form.deviceId.trim() && /^\d{4}-\d{2}-\d{2}$/.test(form.date)
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="font-medium">Repair delayed device punches (Super Admin)</p>
        <p className="text-sm text-text-secondary">
          Punches that reached the system more than 2 minutes late but were saved at their arrival time move to the device
          time + the device's real clock error (seconds, receive − device; e.g. -253 = device 4 min fast). Preview first.
        </p>
        <div className="grid gap-2 sm:grid-cols-4">
          <Input placeholder="Device id (e.g. masoom shah)" value={form.deviceId} onChange={(e) => setForm({ ...form, deviceId: e.target.value })} />
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input type="number" placeholder="Clock error (s)" value={form.offsetSec} onChange={(e) => setForm({ ...form, offsetSec: e.target.value })} />
          <div className="flex gap-2">
            <Button variant="outline" disabled={!ready || run.isPending} onClick={() => run.mutate(false)}>
              Preview
            </Button>
            <Button disabled={!ready || run.isPending || !run.data?.count || run.data.applied} onClick={() => run.mutate(true)}>
              Apply
            </Button>
          </div>
        </div>
        {run.data ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Punch</TableHead>
                <TableHead>Saved (arrival)</TableHead>
                <TableHead>Correct</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.data.items.map((i) => (
                <TableRow key={i.logId + i.field}>
                  <TableCell>{i.employee}</TableCell>
                  <TableCell>{i.field === 'checkIn' ? 'Check-in' : 'Check-out'}</TableCell>
                  <TableCell>{formatPKT(i.from)}</TableCell>
                  <TableCell>{formatPKT(i.to)}</TableCell>
                  <TableCell>{i.result ?? (run.data?.applied ? '' : 'preview')}</TableCell>
                </TableRow>
              ))}
              {!run.data.items.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-text-secondary">
                    Nothing to repair
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Device punches the system could not place itself (device clock changed or unknown). */
export function PunchReviewsPage() {
  const queryClient = useQueryClient()
  const [action, setAction] = useState<Action | null>(null)
  const [time, setTime] = useState('')
  const [punchType, setPunchType] = useState<PunchType>('CHECKIN')
  const [note, setNote] = useState('')

  const isSuperAdmin = useAuth().hasRole(['SUPER_ADMIN'])
  const { data = [], isLoading } = useQuery({
    queryKey: ['punch-reviews'],
    queryFn: () => attendanceApi.punchReviews(),
  })

  const open = (accept: boolean, item: PunchReview) => {
    setAction({ accept, item })
    setTime(toPkInput(item.deviceTime ?? item.receivedAt))
    setPunchType(
      item.punchType && item.punchType in PUNCH_TYPE_LABELS
        ? (item.punchType as PunchType)
        : 'CHECKIN',
    )
    setNote('')
  }

  const mutation = useMutation({
    mutationFn: ({ accept, item }: Action) =>
      accept
        ? attendanceApi.applyPunchReview(item.id, {
            time: `${time}:00+05:00`,
            punchType,
          })
        : attendanceApi.dismissPunchReview(item.id, note.trim() || undefined),
    onSuccess: (_res, { accept }) => {
      toast({ title: accept ? 'Punch saved to attendance' : 'Punch dismissed' })
      setAction(null)
      queryClient.invalidateQueries({ queryKey: ['punch-reviews'] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (err: ApiError) =>
      toast({ title: 'Failed', description: errText(err), variant: 'destructive' }),
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Punches to Review</h1>
        <p className="text-sm text-text-secondary">
          Machine punches that reached the system late from a device whose clock
          was changed or is not known yet, so their real time is uncertain. They
          are not in attendance. Check the time and accept, or dismiss.
        </p>
      </div>

      {isSuperAdmin ? <DelayedPunchRepair /> : null}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>Punch</TableHead>
                <TableHead>Device time</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Reason</TableHead>
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
                    Nothing to review
                  </TableCell>
                </TableRow>
              ) : (
                data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">
                        {item.employee?.fullName ?? '—'}
                      </div>
                      <div className="text-xs text-text-secondary">
                        {item.employee?.employeeCode}
                      </div>
                    </TableCell>
                    <TableCell>{item.employee?.currentBranch?.name ?? '—'}</TableCell>
                    <TableCell>
                      <div>{item.device?.label ?? item.deviceId}</div>
                      <div className="text-xs text-text-secondary">
                        {item.device?.branch?.name}
                      </div>
                    </TableCell>
                    <TableCell>{punchLabel(item.punchType)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {pkDateTime(item.deviceTime)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {pkDateTime(item.receivedAt)}
                    </TableCell>
                    <TableCell className="max-w-[220px] text-sm text-text-secondary">
                      {item.reason}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="bg-primary hover:bg-primary-dark"
                          disabled={!item.employee}
                          onClick={() => open(true, item)}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => open(false, item)}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action?.accept ? 'Accept punch' : 'Dismiss punch'}
            </DialogTitle>
          </DialogHeader>
          {action && (
            <div className="space-y-3">
              <p className="text-sm">
                {action.item.employee?.fullName ?? action.item.deviceId} · device
                time {pkDateTime(action.item.deviceTime)}
              </p>
              {action.accept ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="punch-review-time">
                      Real punch time (Pakistan time)
                    </Label>
                    <Input
                      id="punch-review-time"
                      type="datetime-local"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="punch-review-type">Punch type</Label>
                    <Select
                      value={punchType}
                      onValueChange={(v) => setPunchType(v as PunchType)}
                    >
                      <SelectTrigger id="punch-review-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PUNCH_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="punch-review-note">Note (optional)</Label>
                  <Textarea
                    id="punch-review-note"
                    value={note}
                    maxLength={500}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              variant={action?.accept ? 'default' : 'destructive'}
              disabled={mutation.isPending || (!!action?.accept && !time)}
              onClick={() => action && mutation.mutate(action)}
            >
              {action?.accept ? 'Accept' : 'Dismiss'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
