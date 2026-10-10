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
  amounts?: { basic: number; deductions: number; allowances: number; net: number }
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
        allowances: Number(entry.totalAllowances) || 0,
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
      allowances: formatPKR(entry.totalAllowances),
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
        period: `${monthNames[entry.month - 1] ?? entry.month} ${entry.year}`,
        basic: formatPKR(entry.basicStipend),
        allowances: formatPKR(entry.totalAllowances),
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
        <h2 className="text-xl font-bold">YCDO Central Hospital</h2>
        <p className="text-lg font-semibold">{title}</p>
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
              </>
            ) : (
              <>
                <th className="num">Allowances</th>
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
              <td colSpan={isMonthly ? 15 : 7} className="text-center">
                No payroll records
              </td>
            </tr>
          ) : isMonthly ? (
            <>
              {grouped.groups.map((g) => (
                <Fragment key={`${g.department}|${g.designation}`}>
                  <tr>
                    <td colSpan={15} style={{ fontWeight: 700, background: '#f1f5f5' }}>
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
                  </>
                ) : (
                  <>
                    <td className="num">{row.allowances}</td>
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

type ReportTotals = { basic: number; deductions: number; allowances: number; net: number }

const sumAmounts = (rows: PayrollReportRow[]): ReportTotals =>
  rows.reduce(
    (t, r) => ({
      basic: t.basic + (r.amounts?.basic ?? 0),
      deductions: t.deductions + (r.amounts?.deductions ?? 0),
      allowances: t.allowances + (r.amounts?.allowances ?? 0),
      net: t.net + (r.amounts?.net ?? 0),
    }),
    { basic: 0, deductions: 0, allowances: 0, net: 0 },
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
    'Basic', 'Deductions', 'Allowances', 'Net', 'Payroll status',
  ]]
  const money = (t: ReportTotals) => [t.basic, t.deductions, t.allowances, t.net]
  for (const g of groups) {
    for (const r of g.rows) {
      lines.push([
        g.department, g.designation, r.employee, r.employeeCode, r.employeeStatus,
        r.present, r.absent, r.onLeave, r.late, r.earlyCheckout, r.missingCheckout,
        r.overtime, r.extraWorkingDays,
        ...money(r.amounts ?? { basic: 0, deductions: 0, allowances: 0, net: 0 }),
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
