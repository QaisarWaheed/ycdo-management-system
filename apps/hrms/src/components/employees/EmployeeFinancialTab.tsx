import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { employeeFinancialApi, type FinancialHistoryRow } from '@/api/endpoints/employeeFinancial'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatPKR } from '@/lib/stipendUtils'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthKey = (m: { month: number; year: number }) => `${m.year}-${String(m.month).padStart(2, '0')}`
const monthText = (m: { month: number; year: number }) => `${MONTHS[m.month - 1]} ${m.year}`
const label = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
const money = (v: unknown) =>
  typeof v === 'number' ? formatPKR(v) : v == null ? '—' : typeof v === 'object' ? summarize(v) : String(v)
/** {amount: 3000, endMonth: ...} → "amount 3,000 · endMonth ..." for the trail. */
function summarize(v: object): string {
  return Object.entries(v)
    .filter(([, x]) => x != null && typeof x !== 'object')
    .map(([k, x]) => `${k} ${typeof x === 'number' ? formatPKR(x) : String(x)}`)
    .join(' · ')
}

/**
 * Phase 2 Req 1: fines (overall and per month), payments, deductions with
 * reasons, and every salary / allowance / incentive / deduction change with
 * before → after, date, reason and user. "Letters" opens the Letters tab for
 * the same month to cross-check.
 */
export function EmployeeFinancialTab({
  employeeId,
  onOpenLetters,
}: {
  employeeId: string
  onOpenLetters: (month: string) => void
}) {
  const [month, setMonth] = useState('')
  const [area, setArea] = useState('ALL')
  const { data, isLoading, isError } = useQuery({
    queryKey: ['employee-financial', employeeId],
    queryFn: () => employeeFinancialApi.get(employeeId),
  })
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (isError || !data) return <p className="text-sm text-destructive">Could not load financial record.</p>

  const inMonth = (r: { month: number; year: number }) => !month || monthKey(r) === month
  const selected = data.months.find((m) => monthKey(m) === month)
  const cards = [
    { label: 'Fines', value: selected ? selected.fines : data.totals.fines },
    { label: 'Other deductions', value: selected ? selected.otherDeductions : data.totals.otherDeductions },
    { label: 'Incentives', value: selected ? selected.incentives : data.totals.incentives },
    { label: 'Allowances', value: selected ? selected.allowances : data.totals.allowances },
    { label: 'Overtime', value: selected ? selected.overtime : data.totals.overtime },
    { label: 'Extra duty', value: selected ? selected.extraDuty : data.totals.extraDuty },
  ]
  const areas = ['ALL', ...new Set(data.history.map((h) => h.area.replace(/ \d+\/\d+$/, '')))]
  const historyRows = data.history.filter((h: FinancialHistoryRow) => {
    if (area !== 'ALL' && !h.area.startsWith(area)) return false
    if (!month) return true
    const d = new Date(h.at)
    return format(d, 'yyyy-MM') === month || h.area.endsWith(` ${Number(month.slice(5))}/${month.slice(0, 4)}`)
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          <option value="">All months (overall)</option>
          {data.months.map((m) => (
            <option key={monthKey(m)} value={monthKey(m)}>
              {monthText(m)}
            </option>
          ))}
        </select>
        {month ? (
          <Button size="sm" variant="outline" onClick={() => onOpenLetters(month)}>
            Letters of this month ({selected?.letters ?? 0})
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">
                {c.label} {month ? '' : '(overall)'}
              </div>
              <div className="text-lg font-semibold tabular-nums">{formatPKR(c.value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Month by month</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {['Month', 'Basic', 'Allowances', 'Incentives', 'Overtime', 'Extra duty', 'Fines', 'Other deductions', 'Net', 'Letters'].map(
                  (h) => (
                    <TableHead key={h} className={h === 'Month' ? '' : 'text-right'}>
                      {h}
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.months.map((m) => (
                <TableRow
                  key={monthKey(m)}
                  className={monthKey(m) === month ? 'bg-muted/50' : 'cursor-pointer'}
                  onClick={() => setMonth(monthKey(m))}
                >
                  <TableCell className="whitespace-nowrap">
                    {monthText(m)}
                    <div className="text-xs text-muted-foreground">{label(m.status)}</div>
                  </TableCell>
                  {[m.basic, m.allowances, m.incentives, m.overtime, m.extraDuty, m.fines, m.otherDeductions, m.net].map(
                    (v, i) => (
                      <TableCell key={i} className="text-right tabular-nums">
                        {v ? formatPKR(v) : '—'}
                      </TableCell>
                    ),
                  )}
                  <TableCell className="text-right">
                    {m.letters ? (
                      <Button
                        size="sm"
                        variant="link"
                        className="h-auto p-0"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenLetters(monthKey(m))
                        }}
                      >
                        {m.letters}
                      </Button>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fines and deductions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableBody>
                {data.deductions.filter(inMonth).map((d, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap">{monthText(d)}</TableCell>
                    <TableCell>
                      {label(d.reason)}
                      {d.fineReason ? ` · ${label(d.fineReason)}` : ''}
                      {d.description ? <div className="text-xs text-muted-foreground">{d.description}</div> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPKR(d.amount)}</TableCell>
                  </TableRow>
                ))}
                {!data.deductions.some(inMonth) ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground">No deductions</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Incentives, allowances and payments</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableBody>
                {data.payments.filter(inMonth).map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap">{monthText(p)}</TableCell>
                    <TableCell>{p.description ?? label(p.type)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPKR(p.amount)}</TableCell>
                  </TableRow>
                ))}
                {!data.payments.some(inMonth) ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground">
                      No extra payments (package allowances are in the month table)
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Change history (audit trail)</CardTitle>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={area}
            onChange={(e) => setArea(e.target.value)}
          >
            {areas.map((a) => (
              <option key={a} value={a}>
                {a === 'ALL' ? 'All changes' : a}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Previous</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyRows.map((h, i) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-nowrap">{format(new Date(h.at), 'dd/MM/yyyy HH:mm')}</TableCell>
                  <TableCell className="whitespace-nowrap">{h.area}</TableCell>
                  <TableCell>{label(h.action)}</TableCell>
                  <TableCell className="max-w-[220px] text-xs">{money(h.before)}</TableCell>
                  <TableCell className="max-w-[220px] text-xs">{money(h.after)}</TableCell>
                  <TableCell className="max-w-[260px] text-xs">{h.reason ?? '—'}</TableCell>
                  <TableCell className="text-xs">{h.by ?? '—'}</TableCell>
                </TableRow>
              ))}
              {historyRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No changes recorded
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
