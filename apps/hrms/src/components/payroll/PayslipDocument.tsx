import { amountInWords } from '@/lib/amountInWords'
import type { PayslipSlipData } from '@/lib/payslipSlip'
import { formatPKR } from '@/lib/stipendUtils'
import { cn } from '@/lib/utils'
import { deductionReasonLabel } from '@/types'

function fmtAmount(amount: number) {
  if (!amount) return 'Nil'
  return formatPKR(amount)
}

function display(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—'
  return value
}

type Row = { label: string; amount: number }

function payslipEarningRows(slip: PayslipSlipData): Row[] {
  return [
    { label: 'Stipend', amount: slip.earnings.stipend },
    { label: 'Extra Day', amount: slip.earnings.extraDuty },
    { label: 'Previous Month', amount: slip.earnings.previousMonth },
    { label: 'Reward On Progress', amount: slip.earnings.rewardOnProgress },
    { label: 'Rewards', amount: slip.earnings.rewards },
    { label: 'Other Allowance', amount: slip.earnings.otherAllowance },
    { label: 'Fuel', amount: slip.earnings.fuel },
    { label: 'Mobile Load', amount: slip.earnings.mobileLoad },
  ]
}

function payslipDeductionRows(slip: PayslipSlipData): Row[] {
  const d = slip.deductions
  return [
    { label: 'Advance', amount: d.advance },
    { label: 'Loan', amount: d.loan },
    { label: 'Mobile Load', amount: d.mobileLoad },
    { label: 'Absence', amount: d.absence },
    { label: 'Fine', amount: d.fine },
    { label: 'Medicine Pending', amount: d.staffPendingMed ?? 0 },
    { label: 'Kitchen Pending', amount: d.kitchenPending ?? 0 },
    { label: 'Electricity Bill', amount: d.electricityBill ?? 0 },
    { label: 'Mobile Bill', amount: d.mobileBill ?? 0 },
    { label: 'Health', amount: d.health },
    { label: 'Provident Fund', amount: d.providentFund ?? 0 },
    { label: 'Tax', amount: d.tax ?? 0 },
    { label: 'Other', amount: d.other ?? 0 },
  ]
}

function MetaCell({
  label,
  value,
  compact,
}: {
  label: string
  value: string | number
  compact?: boolean
}) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          'font-medium uppercase tracking-wide text-black/55',
          compact ? 'text-[6pt] leading-tight' : 'text-[10px]',
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          'truncate font-medium',
          compact ? 'text-[7pt] leading-tight' : 'text-xs sm:text-sm',
        )}
      >
        {display(value)}
      </p>
    </div>
  )
}

function MoneyRow({
  label,
  amount,
  bold,
  compact,
}: {
  label: string
  amount: number
  bold?: boolean
  compact?: boolean
}) {
  const cell = compact
    ? 'border border-black/30 px-1 py-[1px] text-[7pt] leading-tight'
    : 'border border-black/30 px-2 py-1 text-xs'
  return (
    <tr className={bold ? 'font-semibold' : undefined}>
      <td className={cell}>{label}</td>
      <td className={cn(cell, 'text-right tabular-nums')}>{fmtAmount(amount)}</td>
    </tr>
  )
}

/**
 * One payslip. `compact` is the quarter-page layout used when printing four
 * payslips per A4 sheet: smaller type, and zero lines left out.
 */
export function PayslipDocument({
  slip,
  compact = false,
}: {
  slip: PayslipSlipData
  compact?: boolean
}) {
  const netPay = slip.netPay ?? slip.totalAmount ?? 0
  const earningRows = payslipEarningRows(slip)
  const deductionRows = payslipDeductionRows(slip)
  const earningsTotal =
    slip.earningsTotal ?? earningRows.reduce((sum, row) => sum + row.amount, 0)
  const deductionsTotal =
    slip.deductionsTotal ??
    deductionRows.reduce((sum, row) => sum + row.amount, 0)

  const visibleEarnings = compact
    ? earningRows.filter((row) => row.amount)
    : earningRows
  const visibleDeductions = compact
    ? deductionRows.filter((row) => row.amount)
    : deductionRows
  const deductionItems = slip.deductionItems ?? []

  const th = compact
    ? 'border border-black/30 px-1 py-[1px] text-[7pt] font-semibold leading-tight'
    : 'border border-black/30 px-2 py-1 text-xs font-semibold'

  return (
    <div
      className={cn(
        'print-content bg-white text-black',
        compact
          ? 'payslip-compact h-full'
          : 'mx-auto max-w-[820px] overflow-x-auto p-2 sm:p-4',
      )}
    >
      <div
        className={cn(
          'min-w-0 border border-black',
          compact ? 'flex h-full flex-col p-2' : 'p-3 sm:p-4',
        )}
      >
        <div className={cn('text-center', compact ? 'mb-1' : 'mb-3')}>
          <h2
            className={cn(
              'font-bold uppercase tracking-wide',
              compact ? 'text-[8.5pt] leading-tight' : 'text-sm sm:text-base',
            )}
          >
            {slip.orgName}
          </h2>
          <p
            className={cn(
              'font-semibold',
              compact ? 'text-[7.5pt] leading-tight' : 'mt-1 text-xs sm:text-sm',
            )}
          >
            {slip.title}
          </p>
        </div>

        <div
          className={cn(
            'grid grid-cols-2 border-b border-black/20',
            compact ? 'mb-1 gap-x-2 gap-y-0.5 pb-1' : 'mb-4 gap-x-6 gap-y-2 pb-3',
          )}
        >
          <MetaCell compact={compact} label="CNIC" value={slip.cnic} />
          <MetaCell
            compact={compact}
            label="Hospital"
            value={slip.hospital || slip.workPlace}
          />
          <MetaCell compact={compact} label="Name" value={slip.employeeName} />
          <MetaCell compact={compact} label="Work Place" value={slip.workPlace} />
          <MetaCell compact={compact} label="Designation" value={slip.designation} />
          <MetaCell
            compact={compact}
            label="Period"
            value={slip.period || slip.payPeriod}
          />
          <MetaCell compact={compact} label="Total Day" value={slip.totalDays} />
          <MetaCell compact={compact} label="Leave" value={slip.leaveDays ?? 0} />
          <MetaCell compact={compact} label="Time" value={slip.dutyTime || '—'} />
          <MetaCell compact={compact} label="Presence" value={slip.presence ?? 0} />
        </div>

        <div
          className={cn(
            'grid grid-cols-2',
            compact ? 'gap-1' : 'grid-cols-1 gap-3 sm:grid-cols-2 print:grid-cols-2',
          )}
        >
          <table className="w-full self-start border-collapse">
            <thead>
              <tr className="bg-black/5">
                <th className={cn(th, 'text-left')}>Pay &amp; Allowances</th>
                <th className={cn(th, 'text-right')}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {visibleEarnings.map((row) => (
                <MoneyRow key={row.label} compact={compact} {...row} />
              ))}
              <MoneyRow
                compact={compact}
                label={compact ? 'Total' : 'Stipend & Other Allowances'}
                amount={earningsTotal}
                bold
              />
            </tbody>
          </table>

          <table className="w-full self-start border-collapse">
            <thead>
              <tr className="bg-black/5">
                <th className={cn(th, 'text-left')}>Deduction</th>
                <th className={cn(th, 'text-right')}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {visibleDeductions.map((row) => (
                <MoneyRow key={row.label} compact={compact} {...row} />
              ))}
              <MoneyRow compact={compact} label="Deduction" amount={deductionsTotal} bold />
              <MoneyRow compact={compact} label="Net Pay" amount={netPay} bold />
            </tbody>
          </table>
        </div>

        {!compact && deductionItems.length > 0 && (
          <div className="mt-3">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-black/5">
                  <th className={cn(th, 'text-left')}>Deduction Reason</th>
                  <th className={cn(th, 'text-left')}>Description</th>
                  <th className={cn(th, 'text-right')}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {deductionItems.map((d, i) => (
                  <tr key={i}>
                    <td className="border border-black/30 px-2 py-1 text-xs">
                      {deductionReasonLabel(d.reason)}
                    </td>
                    <td className="border border-black/30 px-2 py-1 text-xs">
                      {d.description || '—'}
                    </td>
                    <td className="border border-black/30 px-2 py-1 text-right text-xs tabular-nums">
                      {fmtAmount(d.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className={cn('text-black/70', compact ? 'mt-1 text-[6.5pt]' : 'mt-3 text-xs')}>
          Paid Through: {slip.paidThrough || 'Nil'}
        </p>
        <p
          className={cn(
            'break-words',
            compact ? 'mt-0.5 text-[6.5pt] leading-tight' : 'mt-2 text-xs',
          )}
        >
          <span className="font-medium">Amount in words: </span>
          {amountInWords(netPay)}
        </p>
        {!compact && (
          <p className="mt-2 text-[11px] text-black/70">
            Bank Charges (if any) will be deducted from Stipend by the bank
          </p>
        )}

        <div
          className={cn(
            'grid grid-cols-3 gap-2 text-center',
            compact ? 'mt-auto pt-4 text-[6pt]' : 'mt-8 text-[10px] sm:text-xs',
          )}
        >
          {['President YCDO', 'Chairman Admin YCDO', 'Chairman Finance YCDO'].map(
            (signatory) => (
              <div key={signatory}>
                <div
                  className={cn('border-b border-black/40', compact ? 'mb-1' : 'mb-6')}
                />
                <p>{signatory}</p>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  )
}
