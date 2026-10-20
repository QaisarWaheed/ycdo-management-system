import { format } from 'date-fns'
import type { EmployeeLoan } from '@/api/endpoints/loans'

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`

/** Loan application for the Founder's signature, in its own window. */
export function printLoanApplication(opts: {
  loan: EmployeeLoan
  employeeName?: string
  employeeCode?: string
  designation?: string | null
  branch?: string | null
  joiningDate: string
  serviceMonths: number
}) {
  const { loan } = opts
  const months = Math.ceil(loan.amount / loan.monthlyInstallment)
  const w = window.open('', '_blank')
  if (!w) return
  const rows = [
    ['Employee', `${opts.employeeName ?? ''} (${opts.employeeCode ?? ''})`],
    ['Designation', opts.designation ?? '—'],
    ['Branch', opts.branch ?? '—'],
    ['Joining date', format(new Date(opts.joiningDate), 'dd MMM yyyy')],
    ['Service', `${opts.serviceMonths} months`],
    ['Loan amount', pkr(loan.amount)],
    ['Monthly installment', pkr(loan.monthlyInstallment)],
    ['Number of installments', String(months)],
    ['Deduction starts', format(new Date(loan.startMonth), 'MMMM yyyy')],
    ['Reason', loan.reason],
  ]
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join('')
  const signs = ['Employee', 'HR', 'Finance', 'CEO', 'Founder (Approved / Rejected)']
    .map((s) => `<div class="s">${s}</div>`)
    .join('')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Loan Application - ${esc(opts.employeeName)}</title>
<style>@page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;font-size:13px;color:#000}
h2{text-align:center;margin:0 0 4px}h3{text-align:center;margin:0 0 20px;text-decoration:underline}
table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #999;padding:7px 9px;text-align:left}
th{width:35%;background:#f2f2f2}.meta{display:flex;justify-content:space-between;margin-bottom:8px}
.sig{display:grid;grid-template-columns:repeat(3,1fr);gap:28px 24px;margin-top:70px}
.s{border-top:1px solid #000;padding-top:4px;text-align:center}</style></head><body>
<h2>YCDO</h2><h3>Staff Loan Application</h3>
<div class="meta"><span>Application no: ${esc(loan.id.slice(0, 8).toUpperCase())}</span><span>Date: ${format(new Date(loan.createdAt), 'dd MMM yyyy')}</span></div>
<table>${rows}</table>
<p>I request the above loan and agree that the monthly installment will be deducted from my salary from the month stated until the full amount is repaid.</p>
<div class="sig">${signs}</div>
<script>window.onload=()=>window.print()</script></body></html>`)
  w.document.close()
}
