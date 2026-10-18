import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import api from '@/api/axios'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'
import { formatPKR } from '@/lib/stipendUtils'

interface Issue {
  kind: 'MISSING_DEDUCTION' | 'REVERSED_STILL_DEDUCTED' | 'AMOUNT_MISMATCH'
  employeeId: string
  employeeName: string
  employeeCode: string | null
  letterNo: string | null
  letterId: string | null
  month: number
  year: number
  letterAmount: number | null
  deductedAmount: number | null
  slipStatus: string | null
}
const KIND: Record<Issue['kind'], string> = {
  MISSING_DEDUCTION: 'Letter sent, fine not deducted',
  REVERSED_STILL_DEDUCTED: 'Letter reversed / deleted, fine still deducted',
  AMOUNT_MISMATCH: 'Deducted amount differs from letter',
}

/** Phase 3 Req 18: fine letters vs salary deductions; HR deducts or waives each missing fine. */
export function FineAuditPage() {
  const queryClient = useQueryClient()
  const [waiving, setWaiving] = useState<Issue | null>(null)
  const [reason, setReason] = useState('')
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['fine-audit'] })
    queryClient.invalidateQueries({ queryKey: ['payroll'] })
  }
  const onError = (err: { response?: { data?: { message?: string } } }) =>
    toast({ title: 'Failed', description: String(err.response?.data?.message ?? 'Error'), variant: 'destructive' })
  const deduct = useMutation({
    mutationFn: (i: Issue) =>
      api.post<unknown, { deducted: boolean; month: string | null }>(`/fine-audit/${i.letterId}/deduct`),
    onSuccess: (r) => {
      toast({
        title: r.deducted
          ? `Fine deducted on ${r.month} salary`
          : 'No open payroll month yet — it is deducted when the next payroll is generated',
      })
      refresh()
    },
    onError,
  })
  const waive = useMutation({
    mutationFn: () => api.post(`/fine-audit/${waiving!.letterId}/waive`, { reason: reason.trim() }),
    onSuccess: () => {
      toast({ title: 'Fine waived — it will not be deducted' })
      setWaiving(null)
      setReason('')
      refresh()
    },
    onError,
  })
  const { data, isLoading } = useQuery({
    queryKey: ['fine-audit'],
    queryFn: () =>
      api.get<unknown, { checkedLetters: number; checkedDeductions: number; issues: Issue[] }>('/fine-audit'),
  })
  const issues = data?.issues ?? []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Fine Audit</h1>
        <p className="text-sm text-text-secondary">
          Every sent fine letter (manual, uniform and other) must be deducted once with the letter&apos;s amount; a
          reversed letter must leave no deduction. For each missing fine choose Deduct (taken from the next open
          month) or Waive (kept on record, never deducted).
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          Checked {data?.checkedLetters ?? 0} fine letters and {data?.checkedDeductions ?? 0} letter deductions ·{' '}
          <b>{issues.length}</b> issue(s)
        </span>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Letter</TableHead>
                <TableHead>Month</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead className="text-right">Letter</TableHead>
                <TableHead className="text-right">Deducted</TableHead>
                <TableHead>Slip</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8}>Checking…</TableCell>
                </TableRow>
              ) : issues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-text-secondary">
                    All fine letters and deductions match.
                  </TableCell>
                </TableRow>
              ) : (
                issues.map((i, n) => (
                  <TableRow key={n}>
                    <TableCell>
                      <EmployeeNameLink employeeId={i.employeeId} name={i.employeeName} />
                      <div className="text-xs text-text-secondary">{i.employeeCode}</div>
                    </TableCell>
                    <TableCell className="text-xs">{i.letterNo ?? i.letterId ?? '—'}</TableCell>
                    <TableCell>
                      {i.month}/{i.year}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{KIND[i.kind]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.letterAmount != null ? formatPKR(i.letterAmount) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.deductedAmount != null ? formatPKR(i.deductedAmount) : '—'}</TableCell>
                    <TableCell className="text-xs">{i.slipStatus ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {i.kind === 'MISSING_DEDUCTION' && i.letterId ? (
                        <div className="flex gap-2">
                          <Button size="sm" disabled={deduct.isPending} onClick={() => deduct.mutate(i)}>
                            Deduct
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setWaiving(i)}>
                            Waive
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={!!waiving} onOpenChange={(o) => !o && setWaiving(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Waive fine · {waiving?.employeeName}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Letter {waiving?.letterNo} ({waiving?.month}/{waiving?.year}) stays on record but is never deducted.
          </p>
          <Input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaiving(null)}>
              Cancel
            </Button>
            <Button disabled={reason.trim().length < 3 || waive.isPending} onClick={() => waive.mutate()}>
              Waive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
