import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import api from '@/api/axios'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatPKR } from '@/lib/stipendUtils'

type Bucket = 'allowances' | 'incentives' | 'deductions'
export interface ItemizedRow {
  employeeId: string
  name: string
  code: string
  status: string | null
  branch: string
  department: string
  designation: string
  basic: number
  net: number
  allowances: Record<string, number>
  incentives: Record<string, number>
  deductions: Record<string, number>
}

const itemized = (month: number, year: number) =>
  api.get<unknown, { rows: ItemizedRow[] }>('/payroll/reports/itemized', {
    params: { month, year },
  })

const ALL = '__all__'
const sum = (o: Record<string, number>) => Object.values(o).reduce((s, n) => s + n, 0)
const r2 = (n: number) => Math.round(n * 100) / 100
const thisMonth = () => format(new Date(), 'yyyy-MM')
const monthText = (v: string) => format(new Date(`${v}-15`), 'MMMM yyyy')
const prevMonth = (v: string) => {
  const [y, m] = v.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Print a plain table in its own window (A4 landscape). Last row is the total row. */
function printTable(title: string, header: string[], rows: unknown[][]) {
  const esc = (v: unknown) =>
    String(v ?? '').replace(
      /[&<>]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c,
    )
  const w = window.open('', '_blank')
  if (!w) return
  const body = rows
    .map(
      (r, i) =>
        `<tr${i === rows.length - 1 ? ' class="t"' : ''}>${r
          .map(
            (c) =>
              `<td${typeof c === 'number' ? ' class="n"' : ''}>${esc(
                typeof c === 'number' ? c.toLocaleString('en-PK') : c,
              )}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial,sans-serif;font-size:10px}
h2{font-size:14px;margin:0 0 8px}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #999;padding:3px 5px}th{background:#eee}td.n{text-align:right}
tr.t td{font-weight:bold;background:#f5f5f5}</style></head><body>
<h2>YCDO — ${esc(title)}</h2><table><thead><tr>${header
    .map((h) => `<th>${esc(h)}</th>`)
    .join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`)
  w.document.close()
  w.focus()
  w.print()
}

/** Payroll → Reports: itemised allowances / incentives / deductions and month comparison. */
export function PayrollReportsTab() {
  const [monthValue, setMonthValue] = useState(thisMonth())
  const [view, setView] = useState<Bucket | 'compare'>('allowances')
  const [branch, setBranch] = useState(ALL)
  const [department, setDepartment] = useState(ALL)
  const [designation, setDesignation] = useState(ALL)
  const [search, setSearch] = useState('')
  const [y, m] = monthValue.split('-').map(Number)
  const prev = prevMonth(monthValue)
  const [py, pm] = prev.split('-').map(Number)

  const current = useQuery({
    queryKey: ['payroll', 'itemized', y, m],
    queryFn: () => itemized(m, y),
    enabled: !!y && !!m,
  })
  const previous = useQuery({
    queryKey: ['payroll', 'itemized', py, pm],
    queryFn: () => itemized(pm, py),
    enabled: view === 'compare' && !!py,
  })

  const allRows = current.data?.rows ?? []
  const options = (key: 'branch' | 'department' | 'designation') =>
    [...new Set(allRows.map((r) => r[key]))].sort()
  const keep = (r: ItemizedRow) =>
    (branch === ALL || r.branch === branch) &&
    (department === ALL || r.department === department) &&
    (designation === ALL || r.designation === designation) &&
    (!search.trim() ||
      `${r.name} ${r.code}`.toLowerCase().includes(search.trim().toLowerCase()))
  const rows = allRows.filter(keep)
  const prevRows = (previous.data?.rows ?? []).filter(keep)

  const filterLabel = [branch, department, designation].filter((v) => v !== ALL).join(' · ')
  const filters = [
    { key: 'branch' as const, value: branch, set: setBranch },
    { key: 'department' as const, value: department, set: setDepartment },
    { key: 'designation' as const, value: designation, set: setDesignation },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="report-month">Month</Label>
          <Input
            id="report-month"
            type="month"
            value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)}
            className="w-44"
          />
        </div>
        {filters.map(({ key, value, set }) => (
          <div key={key} className="space-y-1">
            <Label className="capitalize">{key}</Label>
            <Select value={value} onValueChange={set}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {options(key).map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor="report-search">Search</Label>
          <Input
            id="report-search"
            placeholder="Name or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
        </div>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as Bucket | 'compare')}>
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="allowances">Allowances</TabsTrigger>
          <TabsTrigger value="incentives">Incentives &amp; Rewards</TabsTrigger>
          <TabsTrigger value="deductions">Deductions</TabsTrigger>
          <TabsTrigger value="compare">Month comparison</TabsTrigger>
        </TabsList>
      </Tabs>

      {current.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : view === 'compare' ? (
        <ComparisonReport
          current={rows}
          previous={prevRows}
          loading={previous.isLoading}
          title={`Month comparison — ${monthText(prev)} vs ${monthText(monthValue)}${
            filterLabel ? ` — ${filterLabel}` : ''
          }`}
          fileName={`payroll-comparison-${prev}-vs-${monthValue}`}
        />
      ) : (
        <ItemizedReport
          rows={rows}
          bucket={view}
          title={`${
            view === 'allowances'
              ? 'Allowances'
              : view === 'incentives'
                ? 'Incentives & rewards'
                : 'Deductions'
          } — ${monthText(monthValue)}${filterLabel ? ` — ${filterLabel}` : ''}`}
          fileName={`payroll-${view}-${monthValue}`}
        />
      )}
    </div>
  )
}

function ItemizedReport({
  rows,
  bucket,
  title,
  fileName,
}: {
  rows: ItemizedRow[]
  bucket: Bucket
  title: string
  fileName: string
}) {
  const withAmounts = useMemo(
    () => rows.filter((r) => Object.keys(r[bucket]).length > 0),
    [rows, bucket],
  )
  const labels = useMemo(() => {
    const totals = new Map<string, number>()
    for (const r of withAmounts) {
      for (const [k, v] of Object.entries(r[bucket])) totals.set(k, (totals.get(k) ?? 0) + v)
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }, [withAmounts, bucket])
  const colTotal = (label: string) =>
    r2(withAmounts.reduce((s, r) => s + (r[bucket][label] ?? 0), 0))
  const grand = r2(withAmounts.reduce((s, r) => s + sum(r[bucket]), 0))

  const header = ['Employee', 'Code', 'Department', 'Designation', ...labels, 'Total']
  const table: unknown[][] = [
    ...withAmounts.map((r) => [
      r.name,
      r.code,
      r.department,
      r.designation,
      ...labels.map((l) => r[bucket][l] ?? 0),
      r2(sum(r[bucket])),
    ]),
    [`Total (${withAmounts.length})`, '', '', '', ...labels.map(colTotal), grand],
  ]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!withAmounts.length}
            onClick={() => downloadCsv(fileName, header, table)}
          >
            Export Excel
          </Button>
          <Button
            variant="outline"
            disabled={!withAmounts.length}
            onClick={() => printTable(title, header, table)}
          >
            Print
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {header.map((h, i) => (
                  <th
                    key={h}
                    className={`whitespace-nowrap px-3 py-2 ${i >= 4 ? 'text-right' : 'text-left'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {withAmounts.length === 0 ? (
                <tr>
                  <td
                    colSpan={header.length}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    Nothing for this month
                  </td>
                </tr>
              ) : (
                table.map((r, i) => (
                  <tr
                    key={i}
                    className={
                      i === table.length - 1 ? 'border-t-2 bg-muted/40 font-semibold' : 'border-t'
                    }
                  >
                    {r.map((c, j) => (
                      <td
                        key={j}
                        className={`whitespace-nowrap px-3 py-1.5 ${
                          j >= 4 ? 'text-right tabular-nums' : ''
                        }`}
                      >
                        {j >= 4 ? (Number(c) ? formatPKR(Number(c)) : '—') : String(c)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

type Metric = 'basic' | 'allowances' | 'incentives' | 'deductions' | 'net'
const METRICS: Array<{ key: Metric; label: string; upIsGood: boolean }> = [
  { key: 'basic', label: 'Basic', upIsGood: true },
  { key: 'allowances', label: 'Allowances', upIsGood: true },
  { key: 'incentives', label: 'Incentives', upIsGood: true },
  { key: 'deductions', label: 'Deductions', upIsGood: false },
  { key: 'net', label: 'Net', upIsGood: true },
]

function totalsOf(r?: ItemizedRow): Record<Metric, number> {
  return {
    basic: r?.basic ?? 0,
    allowances: r2(sum(r?.allowances ?? {})),
    incentives: r2(sum(r?.incentives ?? {})),
    deductions: r2(sum(r?.deductions ?? {})),
    net: r?.net ?? 0,
  }
}

function changedLines(prev?: ItemizedRow, cur?: ItemizedRow): string {
  const parts: string[] = []
  for (const b of ['allowances', 'incentives', 'deductions'] as const) {
    const keys = new Set([...Object.keys(prev?.[b] ?? {}), ...Object.keys(cur?.[b] ?? {})])
    for (const k of keys) {
      const d = r2((cur?.[b][k] ?? 0) - (prev?.[b][k] ?? 0))
      if (Math.abs(d) >= 1) {
        parts.push(
          `${k} ${d > 0 ? '+' : '−'}${Math.abs(Math.round(d)).toLocaleString('en-PK')}`,
        )
      }
    }
  }
  return parts.join(' · ')
}

function ComparisonReport({
  current,
  previous,
  loading,
  title,
  fileName,
}: {
  current: ItemizedRow[]
  previous: ItemizedRow[]
  loading: boolean
  title: string
  fileName: string
}) {
  const [onlyChanged, setOnlyChanged] = useState(true)
  const prevById = new Map(previous.map((r) => [r.employeeId, r]))
  const curById = new Map(current.map((r) => [r.employeeId, r]))
  const ids = [
    ...new Set([...current.map((r) => r.employeeId), ...previous.map((r) => r.employeeId)]),
  ]
  const rows = ids
    .map((id) => {
      const p = prevById.get(id)
      const c = curById.get(id)
      const pt = totalsOf(p)
      const ct = totalsOf(c)
      return {
        id,
        who: (c ?? p) as ItemizedRow,
        p,
        c,
        pt,
        ct,
        diff: r2(ct.net - pt.net),
        lines: changedLines(p, c),
      }
    })
    .filter((r) => !onlyChanged || Math.abs(r.diff) >= 1)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))

  const header = [
    'Employee',
    'Code',
    'Department',
    ...METRICS.flatMap((m) => [`${m.label} (prev)`, `${m.label} (now)`, `${m.label} diff`]),
    'What changed',
  ]
  const table = rows.map((r) => [
    r.who.name,
    r.who.code,
    r.who.department,
    ...METRICS.flatMap((m) => [r.pt[m.key], r.ct[m.key], r2(r.ct[m.key] - r.pt[m.key])]),
    r.lines,
  ])
  const netPrev = r2(rows.reduce((s, r) => s + r.pt.net, 0))
  const netNow = r2(rows.reduce((s, r) => s + r.ct.net, 0))

  if (loading) return <p className="text-sm text-muted-foreground">Loading previous month…</p>

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyChanged}
              onChange={(e) => setOnlyChanged(e.target.checked)}
            />
            Only employees whose net changed
          </label>
          <Button
            variant="outline"
            disabled={!rows.length}
            onClick={() => downloadCsv(fileName, header, table)}
          >
            Export Excel
          </Button>
          <Button
            variant="outline"
            disabled={!rows.length}
            onClick={() =>
              printTable(
                title,
                ['Employee', 'Department', 'Net (prev)', 'Net (now)', 'Difference', 'What changed'],
                [
                  ...rows.map((r) => [r.who.name, r.who.department, r.pt.net, r.ct.net, r.diff, r.lines]),
                  [`Total (${rows.length})`, '', netPrev, netNow, r2(netNow - netPrev), ''],
                ],
              )
            }
          >
            Print
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Employee</th>
                {METRICS.map((m) => (
                  <th key={m.key} className="whitespace-nowrap px-3 py-2 text-right">
                    {m.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-left">What changed</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    No differences
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="px-3 py-1.5">
                      <div className="font-medium">{r.who.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.who.code} · {r.who.department}
                        {!r.p ? ' · new this month' : !r.c ? ' · not in this month' : ''}
                      </div>
                    </td>
                    {METRICS.map((m) => {
                      const d = r2(r.ct[m.key] - r.pt[m.key])
                      const good = (d > 0) === m.upIsGood
                      return (
                        <td
                          key={m.key}
                          className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums"
                        >
                          <div>{formatPKR(r.ct[m.key])}</div>
                          <div className="text-xs text-muted-foreground">
                            was {formatPKR(r.pt[m.key])}
                          </div>
                          {d !== 0 ? (
                            <div
                              className={`text-xs font-medium ${
                                good ? 'text-green-700' : 'text-red-700'
                              }`}
                            >
                              {d > 0 ? '+' : '−'}
                              {formatPKR(Math.abs(d))}
                            </div>
                          ) : null}
                        </td>
                      )
                    })}
                    <td className="max-w-md px-3 py-1.5 text-xs">{r.lines || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
