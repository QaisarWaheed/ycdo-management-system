import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  additionalDutiesApi,
  type DutyMissingAllowance,
} from '@/api/endpoints/additionalDuties'
import { isPendingApproval } from '@/api/endpoints/payApprovals'
import { useCanEditPay } from '@/components/payroll/ApproverSelect'
import { AssignAllowanceDialog } from '@/components/payroll/EmployeeAllowancesPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'

const dateText = (iso: string) => format(new Date(`${iso.slice(0, 10)}T12:00:00`), 'dd MMM yyyy')

/**
 * Shown before generating payroll: people holding an additional duty in the
 * month with no allowance paying it. Only a reminder — generation goes on.
 */
export function DutyAllowanceReminderDialog({
  rows,
  month,
  year,
  onContinue,
  onCancel,
}: {
  rows: DutyMissingAllowance[]
  month: number
  year: number
  onContinue: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const canAdd = useCanEditPay()
  const [adding, setAdding] = useState<DutyMissingAllowance | null>(null)
  // Duty id → 'linked' (allowance saved and linked) | 'pending' (sent for approval) | 'closed' (not applicable).
  const [done, setDone] = useState<Record<string, 'linked' | 'pending' | 'closed'>>({})
  const [closing, setClosing] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const closeMonth = async (dutyId: string) => {
    try {
      await additionalDutiesApi.closeMonth(dutyId, { month, year, reason: reason.trim() })
      setDone((d) => ({ ...d, [dutyId]: 'closed' }))
      setClosing(null)
      setReason('')
      toast({ title: 'Closed for this month' })
    } catch {
      toast({ title: 'Could not save the reason', variant: 'destructive' })
    }
  }
  const monthValue = `${year}-${String(month).padStart(2, '0')}`

  return (
    <>
      <Dialog open={!adding} onOpenChange={(open) => !open && onCancel()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Additional duties without an allowance</DialogTitle>
            <DialogDescription>
              These employees hold an additional duty in{' '}
              {format(new Date(year, month - 1), 'MMMM yyyy')} but no allowance pays it. Their
              designation and salary are unchanged. Add the allowance if the role is active this month,
              or mark it Not applicable with the reason to close the check.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Branch / designation</TableHead>
                  <TableHead>Duty</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.employee.fullName}</div>
                      <div className="text-xs text-muted-foreground">{r.employee.employeeCode}</div>
                    </TableCell>
                    <TableCell>
                      <div>{r.employee.currentBranch?.name ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.employee.currentDesignation ?? '—'}
                      </div>
                    </TableCell>
                    <TableCell>{r.title}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {dateText(r.startDate)} – {r.endDate ? dateText(r.endDate) : 'Ongoing'}
                    </TableCell>
                    <TableCell className="text-right">
                      {done[r.id] === 'linked' ? (
                        <Badge>Allowance added</Badge>
                      ) : done[r.id] === 'pending' ? (
                        <Badge variant="secondary">Allowance pending approval</Badge>
                      ) : done[r.id] === 'closed' ? (
                        <Badge variant="outline">Not applicable this month</Badge>
                      ) : closing === r.id ? (
                        <div className="flex min-w-[220px] flex-col items-end gap-1">
                          <input
                            className="w-full rounded border border-border px-2 py-1 text-sm"
                            placeholder="Reason, e.g. role not active this month"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setClosing(null)}>
                              Back
                            </Button>
                            <Button size="sm" disabled={reason.trim().length < 3} onClick={() => closeMonth(r.id)}>
                              Close check
                            </Button>
                          </div>
                        </div>
                      ) : canAdd ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => setAdding(r)}>
                            Add allowance
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setClosing(r.id)}>
                            Not applicable
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Accounts adds it</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onContinue}>Continue generating</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {adding ? (
        <AssignAllowanceDialog
          employeeId={adding.employee.id}
          current={null}
          defaultStartMonth={monthValue}
          // The allowance follows the role's dates, from this payroll month at the earliest.
          defaultPeriod={{
            start:
              adding.startDate.slice(0, 7) < monthValue
                ? `${monthValue}-01`
                : adding.startDate.slice(0, 10),
            end: adding.endDate?.slice(0, 10) ?? null,
          }}
          defaultNote={`${adding.title} (additional duty)`}
          onClose={() => setAdding(null)}
          onSaved={async (res) => {
            const duty = adding
            if (isPendingApproval(res)) {
              // Linked later from the profile once approved.
              setDone((d) => ({ ...d, [duty.id]: 'pending' }))
              return
            }
            // Before the cut-over a package type returns a stipend record, not an allowance.
            if (!('typeId' in res)) return
            try {
              await additionalDutiesApi.linkAllowance(duty.id, res.id)
              setDone((d) => ({ ...d, [duty.id]: 'linked' }))
              queryClient.invalidateQueries({ queryKey: ['additional-duties'] })
            } catch {
              toast({
                title: 'Allowance saved but not linked to the duty',
                description: 'Link it from the employee profile, Payroll tab.',
                variant: 'destructive',
              })
            }
          }}
        />
      ) : null}
    </>
  )
}
