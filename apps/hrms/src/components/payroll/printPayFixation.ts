import { format } from 'date-fns'
import { ORG_DOC_CSS, ORG_HEADER_CSS, orgFooterHtml, orgHeaderHtml } from '@/lib/orgHeader'
import type { EmployeeAllowance } from '@/api/endpoints/payApprovals'
import type { StipendRecord } from '@/types'

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`

/**
 * Pay components on the letter: Basic, then the allowances running in the
 * month the letter takes effect: the package's start month, or this month for
 * a package already running (falls back to the old package fields when none are assigned).
 */
export function payFixationLines(
  stipend: StipendRecord,
  allowances: EmployeeAllowance[],
  today = new Date(),
) {
  const thisMonth = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)).toISOString().slice(0, 10)
  const effectMonth = `${String(stipend.effectiveFrom ?? '').slice(0, 7)}-01`
  const month = effectMonth > thisMonth ? effectMonth : thisMonth
  const running = allowances.filter(
    (a) => a.startMonth.slice(0, 10) <= month && (!a.endMonth || a.endMonth.slice(0, 10) >= month),
  )
  const lines = [{ label: 'Basic Stipend', amount: Number(stipend.basicStipend) || 0 }]
  if (running.length) {
    for (const a of running) lines.push({ label: a.type.name, amount: Number(a.amount) || 0 })
  } else {
    for (const [label, v] of [
      ['Allowances', stipend.allowances],
      ['Reward', stipend.reward],
      ['Progress Reward', stipend.progressReward],
      ['Fuel Allowance', stipend.fuelAllowance],
    ] as const) {
      if (Number(v) > 0) lines.push({ label, amount: Number(v) })
    }
  }
  return lines.filter((l) => l.amount > 0 || l.label === 'Basic Stipend')
}

/** Open the Pay Fixation letter in its own window and print it. */
export function printPayFixation(opts: {
  employeeName?: string
  employeeCode?: string
  designation?: string | null
  branch?: string | null
  stipend: StipendRecord
  allowances: EmployeeAllowance[]
}) {
  const lines = payFixationLines(opts.stipend, opts.allowances)
  const total = lines.reduce((s, l) => s + l.amount, 0)
  const w = window.open('', '_blank')
  if (!w) return
  const rows = lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="n">${pkr(l.amount)}</td></tr>`).join('')
  // Verification order: Finance prepares, the Founder signs last.
  const signs = ['Prepared by (Finance)', 'Chairman Finance', 'Chairman Admin', 'Founder / Chief Executive (Final)']
    .map((s) => `<div class="s">${s}</div>`)
    .join('')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pay Fixation - ${esc(opts.employeeName)}</title>
<style>@page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;font-size:13px;color:#000}
h2{text-align:center;margin:0 0 4px}h3{text-align:center;margin:0 0 24px;text-decoration:underline}
table{border-collapse:collapse;width:100%;margin:12px 0}td{border:1px solid #999;padding:6px 8px}
td.n{text-align:right}tr.t td{font-weight:bold;background:#f2f2f2}
.sig{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:80px}${ORG_HEADER_CSS}${ORG_DOC_CSS}
.s{border-top:1px solid #000;padding-top:4px;text-align:center;font-weight:bold}</style></head><body>
${orgHeaderHtml('Pay Fixation')}
<p>Date: ${format(new Date(), 'dd/MM/yyyy')}</p>
<p>Name: <b>${esc(opts.employeeName)}</b> (${esc(opts.employeeCode)})<br>
Designation: ${esc(opts.designation ?? '—')}<br>Branch: ${esc(opts.branch ?? '—')}</p>
<p>Your pay is fixed as below with effect from <b>${format(new Date(opts.stipend.effectiveFrom), 'dd/MM/yyyy')}</b>.
Deductions (late, absence, leave without pay, fines) apply as per SOP.</p>
<table><tbody>${rows}<tr class="t"><td>Total monthly package</td><td class="n">${pkr(total)}</td></tr></tbody></table>
<div class="sig">${signs}</div>
${orgFooterHtml()}
<script>window.onload=()=>window.print()</script></body></html>`)
  w.document.close()
  w.focus()
}
