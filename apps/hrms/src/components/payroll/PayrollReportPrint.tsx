import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatPKR } from '@/lib/stipendUtils'
import type { PayrollEntry } from '@/types'

export type PayrollReportRow = {
  employee?: string
  employeeCode?: string
  period: string
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
      period: `${entry.month}/${entry.year}`,
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

  return (
    <div id={id} className="payroll-report-print hidden print:block print-content">
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
              <td colSpan={isMonthly ? 6 : 7} className="text-center">
                No payroll records
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
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
            ))
          )}
        </tbody>
      </table>

      {footer ? <p className="payroll-report-print-footer">{footer}</p> : null}
    </div>
  )
}
