import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  allowancesApi,
  type AllowanceProration,
  type IncentiveType,
  type PayAllowanceType,
} from '@/api/endpoints/payApprovals'
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
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'

const MANAGE_ROLES = ['PAYROLL_OFFICER', 'PRESIDENT', 'FOUNDER', 'CHAIRMAN', 'SUPER_ADMIN', 'HR_EXECUTIVE']
const PRORATION_LABEL: Record<AllowanceProration, string> = {
  FULL_MONTH: 'Full month',
  ATTENDANCE: 'By attendance',
}

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

type Editing =
  | { kind: 'allowance'; row: PayAllowanceType | null }
  | { kind: 'incentive'; row: IncentiveType | null }

/** Payroll tab: allowance types and incentive types (Accounts + executives manage). */
export function PayTypesTab() {
  const { hasRole } = useAuth()
  const canManage = hasRole(MANAGE_ROLES)
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Editing | null>(null)

  const { data: allowanceTypes = [] } = useQuery({
    queryKey: ['allowance-types'],
    queryFn: allowancesApi.listTypes,
  })
  const { data: incentiveTypes = [] } = useQuery({
    queryKey: ['incentive-types'],
    queryFn: allowancesApi.listIncentiveTypes,
  })

  const toggle = useMutation({
    mutationFn: (v: { kind: 'allowance' | 'incentive'; id: string; isActive: boolean }) =>
      v.kind === 'allowance'
        ? allowancesApi.updateType(v.id, { isActive: v.isActive })
        : allowancesApi.updateIncentiveType(v.id, { isActive: v.isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowance-types'] })
      queryClient.invalidateQueries({ queryKey: ['incentive-types'] })
    },
    onError: (err: ApiError) =>
      toast({ title: 'Failed to update', description: errText(err), variant: 'destructive' }),
  })

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">Allowance types</CardTitle>
            <p className="text-xs text-muted-foreground">
              &quot;By attendance&quot; pays the amount × paid days ÷ days in month, like Basic.
            </p>
          </div>
          {canManage ? (
            <Button size="sm" onClick={() => setEditing({ kind: 'allowance', row: null })}>
              Add type
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Paid as</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {allowanceTypes.map((t) => (
                <TableRow key={t.id} className={t.isActive ? '' : 'opacity-60'}>
                  <TableCell className="font-medium">
                    {t.name} {!t.isActive ? <Badge variant="secondary">Retired</Badge> : null}
                  </TableCell>
                  <TableCell>{PRORATION_LABEL[t.proration]}</TableCell>
                  <TableCell className="text-right">{t._count?.assignments ?? 0}</TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap text-right">
                    {canManage ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing({ kind: 'allowance', row: t })}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={toggle.isPending}
                          onClick={() =>
                            toggle.mutate({ kind: 'allowance', id: t.id, isActive: !t.isActive })
                          }
                        >
                          {t.isActive ? 'Retire' : 'Restore'}
                        </Button>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">Incentive types</CardTitle>
            <p className="text-xs text-muted-foreground">
              Chosen when an incentive or reward is given.
            </p>
          </div>
          {canManage ? (
            <Button size="sm" onClick={() => setEditing({ kind: 'incentive', row: null })}>
              Add type
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {incentiveTypes.map((t) => (
                <TableRow key={t.id} className={t.isActive ? '' : 'opacity-60'}>
                  <TableCell className="font-medium">
                    {t.name} {!t.isActive ? <Badge variant="secondary">Retired</Badge> : null}
                  </TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap text-right">
                    {canManage ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing({ kind: 'incentive', row: t })}
                        >
                          Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={toggle.isPending}
                          onClick={() =>
                            toggle.mutate({ kind: 'incentive', id: t.id, isActive: !t.isActive })
                          }
                        >
                          {t.isActive ? 'Retire' : 'Restore'}
                        </Button>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing ? <TypeDialog editing={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

function TypeDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(editing.row?.name ?? '')
  const [proration, setProration] = useState<AllowanceProration>(
    editing.kind === 'allowance' ? (editing.row?.proration ?? 'FULL_MONTH') : 'FULL_MONTH',
  )
  const mutation = useMutation({
    mutationFn: () => {
      const n = name.trim()
      if (editing.kind === 'allowance') {
        return editing.row
          ? allowancesApi.updateType(editing.row.id, { name: n, proration })
          : allowancesApi.createType({ name: n, proration })
      }
      return editing.row
        ? allowancesApi.updateIncentiveType(editing.row.id, { name: n })
        : allowancesApi.createIncentiveType({ name: n })
    },
    onSuccess: () => {
      toast({ title: 'Saved' })
      queryClient.invalidateQueries({ queryKey: ['allowance-types'] })
      queryClient.invalidateQueries({ queryKey: ['incentive-types'] })
      onClose()
    },
    onError: (err: ApiError) =>
      toast({ title: 'Failed to save', description: errText(err), variant: 'destructive' }),
  })
  const noun = editing.kind === 'allowance' ? 'allowance type' : 'incentive type'
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing.row ? `Edit ${noun}` : `Add ${noun}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="type-name">Name</Label>
            <Input id="type-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {editing.kind === 'allowance' ? (
            <div className="space-y-1">
              <Label>Paid as</Label>
              <Select value={proration} onValueChange={(v) => setProration(v as AllowanceProration)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL_MONTH">
                    Full month (cut only for mid-month join / exit)
                  </SelectItem>
                  <SelectItem value="ATTENDANCE">By attendance (paid days only)</SelectItem>
                </SelectContent>
              </Select>
              {editing.row ? (
                <p className="text-xs text-muted-foreground">
                  Changing this affects pending payroll months only; processed and paid months stay
                  as they are.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={name.trim().length < 2 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
