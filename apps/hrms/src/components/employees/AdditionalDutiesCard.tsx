import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { additionalDutiesApi, type AdditionalDuty } from '@/api/endpoints/additionalDuties'
import { allowancesApi } from '@/api/endpoints/payApprovals'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
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
import { useAuth } from '@/hooks/useAuth'
import { formatPKR } from '@/lib/stipendUtils'

const HR_ROLES = [
  'SUPER_ADMIN',
  'HR_MANAGER',
  'HR_ADMIN_MANAGER',
  'HR_OPERATIONS_MANAGER',
  'HR_EXECUTIVE',
]
const PAY_ROLES = ['PAYROLL_OFFICER', 'PRESIDENT', 'FOUNDER', 'CHAIRMAN']
const NONE = '__none__'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}
const dateText = (iso: string) => format(new Date(`${iso.slice(0, 10)}T12:00:00`), 'dd MMM yyyy')
const today = () => format(new Date(), 'yyyy-MM-dd')

/** Extra duties (e.g. Ward In-charge) on the profile's Payroll tab. */
export function AdditionalDutiesCard({ employeeId }: { employeeId: string }) {
  const { hasRole } = useAuth()
  const canManage = hasRole(HR_ROLES)
  const canLink = hasRole([...HR_ROLES, ...PAY_ROLES])
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<AdditionalDuty | 'new' | null>(null)
  const [ending, setEnding] = useState<AdditionalDuty | null>(null)
  const [deleting, setDeleting] = useState<AdditionalDuty | null>(null)

  const { data: duties = [], isLoading } = useQuery({
    queryKey: ['additional-duties', employeeId],
    queryFn: () => additionalDutiesApi.list(employeeId),
  })
  const { data: allowances = [] } = useQuery({
    queryKey: ['employee-allowances', employeeId],
    queryFn: () => allowancesApi.listForEmployee(employeeId),
  })
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['additional-duties'] })

  const linkMutation = useMutation({
    mutationFn: (v: { id: string; allowanceId: string | null }) =>
      additionalDutiesApi.linkAllowance(v.id, v.allowanceId),
    onSuccess: () => {
      toast({ title: 'Allowance link saved' })
      refresh()
    },
    onError: (err: ApiError) =>
      toast({ title: 'Failed to link allowance', description: errText(err), variant: 'destructive' }),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => additionalDutiesApi.delete(id),
    onSuccess: () => {
      toast({ title: 'Duty removed' })
      setDeleting(null)
      refresh()
    },
    onError: (err: ApiError) =>
      toast({ title: 'Failed to remove duty', description: errText(err), variant: 'destructive' }),
  })

  const allowanceLabel = (id: string) => {
    const a = allowances.find((x) => x.id === id)
    return a ? `${a.type.name} ${formatPKR(Number(a.amount))}` : 'Linked allowance'
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-lg">Additional duties</CardTitle>
          <p className="text-xs text-muted-foreground">
            Original designation and salary stay the same. Pay for a duty is a separate allowance,
            added by Accounts (with approval like other pay changes).
          </p>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setEditing('new')}>
            Add duty
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Duty</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Allowance</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">Loading…</TableCell>
                </TableRow>
              ) : duties.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No additional duties
                  </TableCell>
                </TableRow>
              ) : (
                duties.map((d) => {
                  const ended = !!d.endDate && d.endDate.slice(0, 10) < today()
                  return (
                    <TableRow key={d.id} className={ended ? 'opacity-60' : ''}>
                      <TableCell>
                        <div className="font-medium">{d.title}</div>
                        {d.note ? <div className="text-xs text-muted-foreground">{d.note}</div> : null}
                      </TableCell>
                      <TableCell>{dateText(d.startDate)}</TableCell>
                      <TableCell>{d.endDate ? dateText(d.endDate) : 'Ongoing'}</TableCell>
                      <TableCell>
                        {canLink ? (
                          <Select
                            value={d.allowanceId ?? NONE}
                            onValueChange={(v) =>
                              linkMutation.mutate({ id: d.id, allowanceId: v === NONE ? null : v })
                            }
                          >
                            <SelectTrigger className="h-8 w-56">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>No allowance</SelectItem>
                              {d.allowanceId && !allowances.some((a) => a.id === d.allowanceId) ? (
                                <SelectItem value={d.allowanceId}>Linked allowance</SelectItem>
                              ) : null}
                              {allowances.map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  {allowanceLabel(a.id)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : d.allowanceId ? (
                          allowanceLabel(d.allowanceId)
                        ) : (
                          <Badge variant="secondary">No allowance</Badge>
                        )}
                      </TableCell>
                      <TableCell className="space-x-1 whitespace-nowrap text-right">
                        {canManage ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setEditing(d)}>
                              Edit
                            </Button>
                            {!d.endDate ? (
                              <Button size="sm" variant="outline" onClick={() => setEnding(d)}>
                                End
                              </Button>
                            ) : null}
                            <Button size="sm" variant="outline" onClick={() => setDeleting(d)}>
                              Delete
                            </Button>
                          </>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {editing ? (
        <DutyDialog
          employeeId={employeeId}
          duty={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      ) : null}
      {ending ? (
        <EndDutyDialog duty={ending} onClose={() => setEnding(null)} onSaved={refresh} />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        title="Delete duty?"
        description={`Remove "${deleting?.title ?? ''}" from the record. To keep history, use End instead.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  )
}

function DutyDialog({
  employeeId,
  duty,
  onClose,
  onSaved,
}: {
  employeeId: string
  duty: AdditionalDuty | null
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(duty?.title ?? '')
  const [startDate, setStartDate] = useState(duty?.startDate.slice(0, 10) ?? today())
  const [endDate, setEndDate] = useState(duty?.endDate?.slice(0, 10) ?? '')
  const [note, setNote] = useState(duty?.note ?? '')
  const mutation = useMutation({
    mutationFn: () =>
      duty
        ? additionalDutiesApi.update(duty.id, {
            title: title.trim(),
            startDate,
            endDate: endDate || null,
            note: note.trim() || null,
          })
        : additionalDutiesApi.create({
            employeeId,
            title: title.trim(),
            startDate,
            endDate: endDate || undefined,
            note: note.trim() || undefined,
          }),
    onSuccess: () => {
      toast({ title: duty ? 'Duty updated' : 'Duty added' })
      onSaved()
      onClose()
    },
    onError: (err: ApiError) =>
      toast({ title: 'Failed to save duty', description: errText(err), variant: 'destructive' }),
  })
  const valid =
    title.trim().length > 0 && title.trim().length <= 100 && !!startDate && (!endDate || endDate >= startDate)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{duty ? 'Edit duty' : 'Add additional duty'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="duty-title">Duty *</Label>
            <Input
              id="duty-title"
              maxLength={100}
              placeholder="e.g. Ward In-charge"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="duty-from">From *</Label>
              <Input id="duty-from" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="duty-to">To (optional)</Label>
              <Input
                id="duty-to"
                type="date"
                min={startDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="duty-note">Note</Label>
            <Textarea id="duty-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            The employee stays in their original designation; salary is calculated once.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EndDutyDialog({
  duty,
  onClose,
  onSaved,
}: {
  duty: AdditionalDuty
  onClose: () => void
  onSaved: () => void
}) {
  const start = duty.startDate.slice(0, 10)
  const [endDate, setEndDate] = useState(today() < start ? start : today())
  const mutation = useMutation({
    mutationFn: () => additionalDutiesApi.update(duty.id, { endDate }),
    onSuccess: () => {
      toast({ title: `${duty.title} ends ${dateText(endDate)}` })
      onSaved()
      onClose()
    },
    onError: (err: ApiError) =>
      toast({ title: 'Failed to end duty', description: errText(err), variant: 'destructive' }),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>End {duty.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="duty-end">Last day of the duty</Label>
          <Input id="duty-end" type="date" min={start} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            A linked allowance is not ended automatically; Accounts ends it separately.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!endDate || endDate < start || mutation.isPending} onClick={() => mutation.mutate()}>
            End duty
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
