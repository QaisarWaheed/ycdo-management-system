import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { incentivesApi, type IncentivePlan } from '@/api/endpoints/incentives'
import { useCanSetIncentive } from '@/components/payroll/ApproverSelect'
import { MonthYearPicker } from '@/components/common/MonthYearPicker'
import { PKRInput } from '@/components/common/PKRInput'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
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
import { formatPKR } from '@/lib/stipendUtils'

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errText = (err: unknown) => {
  const msg = (err as ApiError).response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

const label = (month: number, year: number) =>
  new Date(year, month - 1).toLocaleString('en', { month: 'short', year: 'numeric' })

function status(plan: IncentivePlan, now: { month: number; year: number }) {
  if (plan.stoppedAt) return 'Stopped'
  const current = now.year * 12 + now.month
  if (plan.startYear * 12 + plan.startMonth > current) return 'Upcoming'
  if (plan.endYear != null && plan.endMonth != null && plan.endYear * 12 + plan.endMonth < current)
    return 'Ended'
  return 'Active'
}

/**
 * Point 21: recurring incentives (N months / permanent). Executives can stop
 * one or change its amount for the months not yet in payroll.
 */
export function RecurringIncentivePlans({ employeeId }: { employeeId?: string }) {
  const queryClient = useQueryClient()
  const canEdit = useCanSetIncentive()
  const today = new Date()
  const now = { month: today.getMonth() + 1, year: today.getFullYear() }
  const { data: plans = [] } = useQuery({
    queryKey: ['incentives', 'plans', employeeId ?? 'all'],
    queryFn: () => incentivesApi.plans(employeeId),
  })
  const [amountPlan, setAmountPlan] = useState<IncentivePlan | null>(null)
  const [amount, setAmount] = useState(0)
  const [stopPlan, setStopPlan] = useState<IncentivePlan | null>(null)
  const [last, setLast] = useState(now)

  const done = (title: string) => {
    toast({ title })
    setAmountPlan(null)
    setStopPlan(null)
    queryClient.invalidateQueries({ queryKey: ['incentives'] })
    queryClient.invalidateQueries({ queryKey: ['payroll'] })
  }
  const fail = (err: unknown) =>
    toast({ title: 'Could not save', description: errText(err), variant: 'destructive' })
  const changeAmount = useMutation({
    mutationFn: () => incentivesApi.updatePlan(amountPlan!.id, { amount }),
    onSuccess: () => done('Amount changed for the coming months'),
    onError: fail,
  })
  const stop = useMutation({
    mutationFn: () =>
      incentivesApi.stopPlan(stopPlan!.id, { lastMonth: last.month, lastYear: last.year }),
    onSuccess: () => done('Recurring incentive stopped'),
    onError: fail,
  })

  if (!plans.length) return null

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="text-sm font-medium">Recurring plans</p>
        <Table>
          <TableHeader>
            <TableRow>
              {!employeeId ? <TableHead>Employee</TableHead> : null}
              <TableHead>Type</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Status</TableHead>
              {canEdit ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((p) => {
              const s = status(p, now)
              const open = s === 'Active' || s === 'Upcoming'
              return (
                <TableRow key={p.id}>
                  {!employeeId ? (
                    <TableCell>
                      {p.employee?.fullName}{' '}
                      <span className="text-xs text-text-secondary">{p.employee?.employeeCode}</span>
                    </TableCell>
                  ) : null}
                  <TableCell>{p.type?.name ?? p.reason}</TableCell>
                  <TableCell>{formatPKR(Number(p.amount))}</TableCell>
                  <TableCell>{label(p.startMonth, p.startYear)}</TableCell>
                  <TableCell>
                    {p.endMonth != null && p.endYear != null
                      ? label(p.endMonth, p.endYear)
                      : 'Permanent'}
                  </TableCell>
                  <TableCell>{s}</TableCell>
                  {canEdit ? (
                    <TableCell className="space-x-1 text-right">
                      {open ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setAmount(Number(p.amount))
                              setAmountPlan(p)
                            }}
                          >
                            Change amount
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            onClick={() => {
                              setLast(now)
                              setStopPlan(p)
                            }}
                          >
                            Stop
                          </Button>
                        </>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!amountPlan} onOpenChange={(o) => !o && setAmountPlan(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change amount</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            Applies to months not yet in payroll. Edit this month&apos;s incentive from the
            incentives list.
          </p>
          <PKRInput value={amount} onChange={setAmount} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAmountPlan(null)}>
              Cancel
            </Button>
            <Button
              disabled={amount <= 0 || changeAmount.isPending}
              onClick={() => changeAmount.mutate()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!stopPlan} onOpenChange={(o) => !o && setStopPlan(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Stop recurring incentive</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            Last month it is paid. Months already processed or paid are not changed.
          </p>
          <MonthYearPicker value={last} onChange={setLast} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopPlan(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={stop.isPending}
              onClick={() => stop.mutate()}
            >
              Stop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
