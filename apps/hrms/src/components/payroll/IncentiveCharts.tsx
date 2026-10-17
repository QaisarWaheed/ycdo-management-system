import { useQuery } from '@tanstack/react-query'
import { doctorPerformanceApi } from '@/api/endpoints/doctorPerformance'
import { incentivesApi } from '@/api/endpoints/incentives'
import { Card, CardContent } from '@/components/ui/card'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const num = (n: number) => Math.round(n).toLocaleString('en-PK')

/** One horizontal bar per row, scaled to the largest value. */
export function Bars({ rows }: { rows: Array<{ label: string; value: number; note?: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (!rows.length) return <p className="text-xs text-muted-foreground">No data</p>
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(80px,140px)_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <div className="h-3 rounded bg-muted">
            <div className="h-3 rounded bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="tabular-nums">
            {num(r.value)}
            {r.note ? <span className="ml-1 text-muted-foreground">{r.note}</span> : null}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * End-of-month graphs for executives: incentive per month (last 12), by
 * branch this month, and each doctor's collection against the incentive given.
 */
export function IncentiveCharts({ year, month }: { year: number; month: number }) {
  const { data: stats } = useQuery({
    queryKey: ['incentive-stats', year, month],
    queryFn: () => incentivesApi.stats({ year, month }),
  })
  const { data: doctors } = useQuery({
    queryKey: ['doctor-performance', { year, month }],
    queryFn: () => doctorPerformanceApi.list({ year, month }),
  })
  const doctorRows = (doctors?.rows ?? [])
    .filter((r) => r.current?.collection)
    .map((r) => ({
      label: r.employee.fullName,
      value: r.current!.collection,
      note: `· incentive ${num(r.incentives.filter((i) => !i.pending).reduce((s, i) => s + i.amount, 0))}`,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15)

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="text-sm font-semibold">Incentive per month (PKR)</div>
          <Bars
            rows={(stats?.monthly ?? []).map((m) => ({
              label: `${MONTHS[m.month - 1]} ${m.year}`,
              value: m.total,
            }))}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="text-sm font-semibold">
            By branch · {MONTHS[month - 1]} {year}
          </div>
          <Bars rows={(stats?.byBranch ?? []).map((b) => ({ label: b.branch, value: b.total }))} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="text-sm font-semibold">Doctor collection vs incentive</div>
          <Bars rows={doctorRows} />
        </CardContent>
      </Card>
    </div>
  )
}
