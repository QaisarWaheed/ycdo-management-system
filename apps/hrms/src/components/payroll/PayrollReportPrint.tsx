import { OrgPrintHeader } from '@/components/common/OrgPrintHeader'
import { Fragment } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { employeeStatusLabel } from '@/lib/employeeStatus'
import { formatPKR } from '@/lib/stipendUtils'
import type { PayrollEntry } from '@/types'

export type PayrollReportRow = {
  employee?: string
  employeeCode?: string
  employeeStatus?: string
  department?: string
  designation?: string
  /** Raw amounts for subtotals and the Excel export. */
  amounts?: ReportTotals
  period: string
  present?: string
  absent?: string
  onLeave?: string
  late?: string
  earlyCheckout?: string
  missingCheckout?: string
  overtime?: string
  extraWorkingDays?: string
  basic: string
  deductions: string
  allowances: string
  incentives: string
  net: string
  status: string
  notes?: string
}

type PayrollReportPrintProps = {
  id: string
  title: string
  subtitle?: string
  rows: PayrollReportRow[]
  variant?: 'monthly' | 'history'
  footer?: string
}

/** Incentives on an entry: CUSTOM allowance rows written as "Incentive: …". */
export function incentiveTotal(entry: Pick<PayrollEntry, 'allowances'>): number {
  return (entry.allowances ?? [])
    .filter((a) => a.type === 'CUSTOM' && (a.description ?? '').startsWith('Incentive: '))
    .reduce((sum, a) => sum + (Number(a.amount) || 0), 0)
}

/** Allowances without incentives (incentives get their own column). */
export function allowancesWithoutIncentives(
  entry: Pick<PayrollEntry, 'allowances' | 'totalAllowances'>,
): number {
  return Math.round(((Number(entry.totalAllowances) || 0) - incentiveTotal(entry)) * 100) / 100
}

export function buildMonthlyPayrollReportRows(
  entries: PayrollEntry[],
): PayrollReportRow[] {
  return entries.map((entry) => {
    const emp = entry.stipendRecord?.employee
    const extraDuty = (entry.allowances ?? [])
      .filter(
        (a) =>
          a.type === 'ADDITIONAL_WORKING_DAYS' || a.type === 'RELIEVER',
      )
      .reduce((sum, a) => sum + Number(a.amount), 0)
    const otAllowance = entry.allowances?.find((a) => a.type === 'OVERTIME')
    const notes = [
      extraDuty > 0 ? `Extra duty ${formatPKR(extraDuty)}` : null,
      otAllowance ? `OT ${formatPKR(otAllowance.amount)}` : null,
    ]
      .filter(Boolean)
      .join('; ')

    return {
      employee: emp?.fullName ?? '—',
      employeeCode: emp?.employeeCode ?? '',
      employeeStatus: emp?.status ? employeeStatusLabel(emp.status) : '—',
      department: emp?.currentDepartment?.name || 'No department',
      designation: emp?.currentDesignation || 'No designation',
      amounts: {
        basic: Number(entry.basicStipend) || 0,
        deductions: Math.max(0, Number(entry.totalDeductions) || 0),
        allowances: allowancesWithoutIncentives(entry),
        incentives: incentiveTotal(entry),
        net: Number(entry.netStipend) || 0,
      },
      period: `${entry.month}/${entry.year}`,
      present: String(entry.attendance?.present ?? 0),
      absent: String(entry.attendance?.absent ?? 0),
      onLeave: String(entry.attendance?.onLeave ?? 0),
      late: String(entry.attendance?.late ?? 0),
      earlyCheckout: String(entry.attendance?.earlyCheckout ?? 0),
      missingCheckout: String(entry.attendance?.missingCheckout ?? 0),
      overtime: String(entry.attendance?.overtimeHours ?? 0),
      extraWorkingDays: String(entry.attendance?.extraWorkingDays ?? 0),
      basic: formatPKR(entry.basicStipend),
      deductions: formatPKR(Math.max(0, Number(entry.totalDeductions))),
      allowances: formatPKR(allowancesWithoutIncentives(entry)),
      incentives: formatPKR(incentiveTotal(entry)),
      net: formatPKR(entry.netStipend),
      status: entry.status,
      notes: notes || undefined,
    }
  })
}

export function buildHistoryPayrollReportRows(
  entries: PayrollEntry[],
  monthNames: string[],
): PayrollReportRow[] {
  return [...entries]
    .sort(
      (a, b) =>
        new Date(b.year, b.month - 1).getTime() -
        new Date(a.year, a.month - 1).getTime(),
    )
    .map((entry) => {
      const extraDuty = (entry.allowances ?? [])
        .filter(
          (a) =>
            a.type === 'ADDITIONAL_WORKING_DAYS' || a.type === 'RELIEVER',
        )
        .reduce((sum, a) => sum + Number(a.amount), 0)
      const otAllowance = entry.allowances?.find((a) => a.type === 'OVERTIME')
      const notes = [
        extraDuty > 0 ? `Extra duty ${formatPKR(extraDuty)}` : null,
        otAllowance ? `OT ${formatPKR(otAllowance.amount)}` : null,
      ]
        .filter(Boolean)
        .join('; ')

      return {
        amounts: {
          basic: Number(entry.basicStipend) || 0,
          deductions: Math.max(0, Number(entry.totalDeductions) || 0),
          allowances: allowancesWithoutIncentives(entry),
          incentives: incentiveTotal(entry),
          net: Number(entry.netStipend) || 0,
        },
        period: `${monthNames[entry.month - 1] ?? entry.month} ${entry.year}`,
        basic: formatPKR(entry.basicStipend),
        allowances: formatPKR(allowancesWithoutIncentives(entry)),
        incentives: formatPKR(incentiveTotal(entry)),
        deductions: formatPKR(entry.totalDeductions),
        net: formatPKR(entry.netStipend),
        status: entry.status,
        notes: notes || undefined,
      }
    })
}

export function PrintPayrollReportButton({
  disabled,
  label = 'Print',
}: {
  disabled?: boolean
  label?: string
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={() => window.print()}
    >
      <Printer className="mr-2 h-4 w-4" />
      {label}
    </Button>
  )
}

export function PayrollReportPrintSection({
  id,
  title,
  subtitle,
  rows,
  variant = 'history',
  footer,
}: PayrollReportPrintProps) {
  const isMonthly = variant === 'monthly'
  const grouped = groupPayrollReportRows(isMonthly ? rows : [])

  return (
    <div
      id={id}
      className={
        isMonthly
          ? 'payroll-report-print payroll-report-print--monthly hidden print:block print-content'
          : 'payroll-report-print hidden print:block print-content'
      }
    >
      <div className="payroll-report-print-header">
        <OrgPrintHeader title={title} />
        {subtitle ? <p className="text-sm">{subtitle}</p> : null}
        <p className="text-xs text-gray-600">
          Printed on {new Date().toLocaleString('en-PK')}
        </p>
      </div>

      <table className="payroll-report-table">
        <thead>
          <tr>
            {isMonthly ? <th>Employee</th> : <th>Period</th>}
            {isMonthly ? <th>Employee Status</th> : null}
            {isMonthly ? (
              <>
                <th className="num">Present</th>
                <th className="num">Absent</th>
                <th className="num">On leave</th>
                <th className="num">Late</th>
                <th className="num">Early out</th>
                <th className="num">Missed checkout</th>
                <th className="num">OT hrs</th>
                <th className="num">Extra days</th>
              </>
            ) : null}
            <th className="num">Basic</th>
            {isMonthly ? (
              <>
                <th className="num">Deductions</th>
                <th className="num">Allowances</th>
                <th className="num">Incentives</th>
              </>
            ) : (
              <>
                <th className="num">Allowances</th>
                <th className="num">Incentives</th>
                <th className="num">Deductions</th>
              </>
            )}
            <th className="num">Net</th>
            <th>Status</th>
            {!isMonthly ? <th>Notes</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={isMonthly ? 16 : 8} className="text-center">
                No payroll records
              </td>
            </tr>
          ) : isMonthly ? (
            <>
              {grouped.groups.map((g) => (
                <Fragment key={`${g.department}|${g.designation}`}>
                  <tr>
                    <td colSpan={16} style={{ fontWeight: 700, background: '#f1f5f5' }}>
                      {g.department} — {g.designation}
                    </td>
                  </tr>
                  {g.rows.map(renderRow)}
                  {totalRow(`Subtotal: ${g.designation} (${g.rows.length})`, g.totals)}
                </Fragment>
              ))}
              {totalRow(`Grand total (${rows.length})`, grouped.grandTotal)}
            </>
          ) : (
            rows.map(renderRow)
          )}
        </tbody>
      </table>

      {footer ? <p className="payroll-report-print-footer">{footer}</p> : null}
      <PayrollReportSignOff totals={sumAmounts(rows)} />
      {isMonthly ? (
        <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } }`}</style>
      ) : null}
    </div>
  )

  function totalRow(label: string, t: ReportTotals) {
    return (
      <tr style={{ fontWeight: 600 }}>
        <td colSpan={10}>{label}</td>
        <td className="num">{formatPKR(t.basic)}</td>
        <td className="num">{formatPKR(t.deductions)}</td>
        <td className="num">{formatPKR(t.allowances)}</td>
        <td className="num">{formatPKR(t.incentives)}</td>
        <td className="num">{formatPKR(t.net)}</td>
        <td />
      </tr>
    )
  }

  function renderRow(row: PayrollReportRow, index: number) {
    return (
              <tr key={`${row.period}-${index}`}>
                {isMonthly ? (
                  <td>
                    <div>{row.employee ?? '—'}</div>
                    {row.employeeCode ? (
                      <div className="text-xs">{row.employeeCode}</div>
                    ) : null}
                  </td>
                ) : (
                  <td>{row.period}</td>
                )}
                {isMonthly ? <td>{row.employeeStatus ?? '—'}</td> : null}
                {isMonthly ? (
                  <>
                    <td className="num">{row.present ?? '0'}</td>
                    <td className="num">{row.absent ?? '0'}</td>
                    <td className="num">{row.onLeave ?? '0'}</td>
                    <td className="num">{row.late ?? '0'}</td>
                    <td className="num">{row.earlyCheckout ?? '0'}</td>
                    <td className="num">{row.missingCheckout ?? '0'}</td>
                    <td className="num">{row.overtime ?? '0'}</td>
                    <td className="num">{row.extraWorkingDays ?? '0'}</td>
                  </>
                ) : null}
                <td className="num">{row.basic}</td>
                {isMonthly ? (
                  <>
                    <td className="num">{row.deductions}</td>
                    <td className="num">{row.allowances}</td>
                    <td className="num">{row.incentives}</td>
                  </>
                ) : (
                  <>
                    <td className="num">{row.allowances}</td>
                    <td className="num">{row.incentives}</td>
                    <td className="num">{row.deductions}</td>
                  </>
                )}
                <td className="num">{row.net}</td>
                <td>{row.status}</td>
                {!isMonthly ? <td>{row.notes ?? '—'}</td> : null}
              </tr>
    )
  }
}

type ReportTotals = {
  basic: number
  deductions: number
  allowances: number
  /** Incentives / rewards, shown apart from (fixed) allowances. */
  incentives: number
  net: number
}

/** Signature boxes printed at the end of every payroll report, whatever the filters. */
export const PAYROLL_REPORT_SIGNATORIES = [
  'Prepared by',
  'Chairman Finance',
  'General Secretary',
  'Founder / Head of Organization',
]

export type PayrollReportSummary = ReportTotals

const summaryItems = (t: PayrollReportSummary) => [
  { label: 'Total Earned Stipend', value: t.basic },
  { label: 'Total Allowances', value: t.allowances },
  { label: 'Total Incentives', value: t.incentives },
  { label: 'Total Deductions', value: t.deductions },
  { label: 'Total Net Stipend', value: t.net },
]

/** Report totals, then the signature row — closes every printed payroll report. */
export function PayrollReportSignOff({ totals }: { totals: PayrollReportSummary }) {
  return (
    <div style={{ marginTop: 16, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
      <table className="payroll-report-table" style={{ width: 'auto', marginLeft: 'auto' }}>
        <tbody>
          {summaryItems(totals).map((i) => (
            <tr key={i.label}>
              <th style={{ textAlign: 'left' }}>{i.label}</th>
              <td className="num" style={{ fontWeight: 700, minWidth: 120 }}>
                {formatPKR(i.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${PAYROLL_REPORT_SIGNATORIES.length}, 1fr)`,
          gap: 24,
          marginTop: 56,
        }}
      >
        {PAYROLL_REPORT_SIGNATORIES.map((s) => (
          <div
            key={s}
            style={{ borderTop: '1px solid #000', paddingTop: 4, textAlign: 'center', fontWeight: 600 }}
          >
            {s}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Same sign-off as HTML, for reports printed in their own window. */
export function payrollReportSignOffHtml(totals: PayrollReportSummary) {
  const rows = summaryItems(totals)
    .map((i) => `<tr><th style="text-align:left">${i.label}</th><td class="n" style="font-weight:bold;min-width:120px">${formatPKR(i.value)}</td></tr>`)
    .join('')
  const signs = PAYROLL_REPORT_SIGNATORIES.map(
    (s) => `<div style="border-top:1px solid #000;padding-top:4px;text-align:center;font-weight:bold">${s}</div>`,
  ).join('')
  return `<div style="margin-top:16px;page-break-inside:avoid;break-inside:avoid">
<table style="width:auto;margin-left:auto"><tbody>${rows}</tbody></table>
<div style="display:grid;grid-template-columns:repeat(${PAYROLL_REPORT_SIGNATORIES.length},1fr);gap:24px;margin-top:56px">${signs}</div></div>`
}

const sumAmounts = (rows: PayrollReportRow[]): ReportTotals =>
  rows.reduce(
    (t, r) => ({
      basic: t.basic + (r.amounts?.basic ?? 0),
      deductions: t.deductions + (r.amounts?.deductions ?? 0),
      allowances: t.allowances + (r.amounts?.allowances ?? 0),
      incentives: t.incentives + (r.amounts?.incentives ?? 0),
      net: t.net + (r.amounts?.net ?? 0),
    }),
    { basic: 0, deductions: 0, allowances: 0, incentives: 0, net: 0 },
  )

/** Monthly rows grouped by department, then designation, each with subtotals. */
export function groupPayrollReportRows(rows: PayrollReportRow[]) {
  const map = new Map<string, { department: string; designation: string; rows: PayrollReportRow[] }>()
  for (const row of rows) {
    const department = row.department ?? 'No department'
    const designation = row.designation ?? 'No designation'
    const key = `${department}|${designation}`
    if (!map.has(key)) map.set(key, { department, designation, rows: [] })
    map.get(key)!.rows.push(row)
  }
  const groups = [...map.values()]
    .sort(
      (a, b) =>
        a.department.localeCompare(b.department) ||
        a.designation.localeCompare(b.designation),
    )
    .map((g) => ({
      ...g,
      rows: [...g.rows].sort((a, b) => (a.employee ?? '').localeCompare(b.employee ?? '')),
      totals: sumAmounts(g.rows),
    }))
  return { groups, grandTotal: sumAmounts(rows) }
}

/** Grouped monthly payroll as CSV (opens in Excel), with subtotal and grand-total rows. */
export function exportMonthlyPayrollCsv(rows: PayrollReportRow[], filename: string) {
  const { groups, grandTotal } = groupPayrollReportRows(rows)
  const blank = (n: number) => Array<string>(n).fill('')
  const lines: unknown[][] = [[
    'Department', 'Designation', 'Employee', 'Code', 'Employee status', 'Present', 'Absent',
    'On leave', 'Late', 'Early out', 'Missed checkout', 'OT hrs', 'Extra days',
    'Basic', 'Deductions', 'Allowances', 'Incentives', 'Net', 'Payroll status',
  ]]
  const round2 = (n: number) => Math.round(n * 100) / 100
  const money = (t: ReportTotals) =>
    [t.basic, t.deductions, t.allowances, t.incentives, t.net].map(round2)
  for (const g of groups) {
    for (const r of g.rows) {
      lines.push([
        g.department, g.designation, r.employee, r.employeeCode, r.employeeStatus,
        r.present, r.absent, r.onLeave, r.late, r.earlyCheckout, r.missingCheckout,
        r.overtime, r.extraWorkingDays,
        ...money(r.amounts ?? { basic: 0, deductions: 0, allowances: 0, incentives: 0, net: 0 }),
        r.status,
      ])
    }
    lines.push([g.department, g.designation, `Subtotal (${g.rows.length})`, ...blank(10), ...money(g.totals), ''])
  }
  lines.push(['All', '', `Grand total (${rows.length})`, ...blank(10), ...money(grandTotal), ''])
  const cell = (v: unknown) => {
    const str = v == null ? '' : String(v)
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }
  // BOM so Excel reads Urdu names as UTF-8.
  const csv = '﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
