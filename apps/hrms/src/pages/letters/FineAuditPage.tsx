import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

/** Phase 3 Req 18: fine letters vs salary deductions, with one-click fix. */
export function FineAuditPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['fine-audit'],
    queryFn: () =>
      api.get<unknown, { checkedLetters: number; checkedDeductions: number; issues: Issue[] }>('/fine-audit'),
  })
  const fix = useMutation({
    mutationFn: () => api.post<unknown, { fixed: number; skipped: string[] }>('/fine-audit/fix'),
    onSuccess: (r) => {
      toast({
        title: `${r.fixed} fixed`,
        description: r.skipped.length ? `${r.skipped.length} need manual action: ${r.skipped.join('; ')}` : undefined,
        variant: r.skipped.length ? 'destructive' : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['fine-audit'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
    },
  })
  const issues = data?.issues ?? []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Fine Audit</h1>
        <p className="text-sm text-text-secondary">
          Every sent fine letter (manual, uniform and other) must be deducted once with the letter&apos;s amount; a
          reversed letter must leave no deduction. Fix applies missing fines (next open month when the month is
          verified / processed / paid), removes fines of reversed letters and corrects amounts. Paid slips are never
          changed.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          Checked {data?.checkedLetters ?? 0} fine letters and {data?.checkedDeductions ?? 0} letter deductions ·{' '}
          <b>{issues.length}</b> issue(s)
        </span>
        <Button disabled={!issues.length || fix.isPending} onClick={() => fix.mutate()}>
          Fix all
        </Button>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7}>Checking…</TableCell>
                </TableRow>
              ) : issues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-text-secondary">
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
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
