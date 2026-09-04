import { amountInWords } from '@/lib/amountInWords'
import type { PayslipSlipData } from '@/lib/payslipSlip'
import { formatPKR } from '@/lib/stipendUtils'

function fmtAmount(amount: number) {
  if (!amount) return 'Nil'
  return formatPKR(amount)
}

function display(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—'
  return value
}

function MetaCell({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-black/55">
        {label}
      </p>
      <p className="truncate text-xs font-medium sm:text-sm">{display(value)}</p>
    </div>
  )
}

function MoneyRow({
  label,
  amount,
  bold,
}: {
  label: string
  amount: number
  bold?: boolean
}) {
  return (
    <tr className={bold ? 'font-semibold' : undefined}>
      <td className="border border-black/30 px-2 py-1 text-xs">{label}</td>
      <td className="border border-black/30 px-2 py-1 text-right text-xs tabular-nums">
        {fmtAmount(amount)}
      </td>
    </tr>
  )
}

export function PayslipDocument({ slip }: { slip: PayslipSlipData }) {
  const netPay = slip.netPay ?? slip.totalAmount ?? 0
  const earningsTotal =
    slip.earningsTotal ??
    slip.earnings.stipend +
      slip.earnings.previousMonth +
      slip.earnings.rewardOnProgress +
      slip.earnings.rewards +
      slip.earnings.otherAllowance +
      slip.earnings.fuel +
      slip.earnings.mobileLoad +
      slip.earnings.extraDuty

  const deductionsTotal =
    slip.deductionsTotal ??
    slip.deductions.advance +
      slip.deductions.loan +
      slip.deductions.mobileLoad +
      slip.deductions.absence +
      slip.deductions.fine +
      slip.deductions.health +
      (slip.deductions.providentFund ?? 0) +
      (slip.deductions.tax ?? 0) +
      (slip.deductions.other ?? 0)

  const deductionItems = slip.deductionItems ?? []

  return (
    <div className="print-content mx-auto max-w-[820px] overflow-x-auto bg-white p-2 text-black sm:p-4">
      <div className="min-w-0 border border-black p-3 sm:p-4">
        <div className="mb-3 text-center">
          <h2 className="text-sm font-bold uppercase tracking-wide sm:text-base">
            {slip.orgName}
          </h2>
          <p className="mt-1 text-xs font-semibold sm:text-sm">{slip.title}</p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 border-b border-black/20 pb-3 sm:grid-cols-2">
          <MetaCell label="CNIC" value={slip.cnic} />
          <MetaCell label="Hospital" value={slip.hospital || slip.workPlace} />
          <MetaCell label="Name" value={slip.employeeName} />
          <MetaCell label="Work Place" value={slip.workPlace} />
          <MetaCell label="Designation" value={slip.designation} />
          <MetaCell label="Period" value={slip.period || slip.payPeriod} />
          <MetaCell label="Total Day" value={slip.totalDays} />
          <MetaCell label="Leave" value={slip.leaveDays ?? 0} />
          <MetaCell label="Time" value={slip.dutyTime || '—'} />
          <MetaCell label="Presence" value={slip.presence ?? 0} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 print:grid-cols-2">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-black/5">
                <th className="border border-black/30 px-2 py-1 text-left text-xs font-semibold">
                  Pay &amp; Allowances
                </th>
                <th className="border border-black/30 px-2 py-1 text-right text-xs font-semibold">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              <MoneyRow label="Stipend" amount={slip.earnings.stipend} />
              <MoneyRow label="Extra Day" amount={slip.earnings.extraDuty} />
              <MoneyRow
                label="Previous Month"
                amount={slip.earnings.previousMonth}
              />
              <MoneyRow
                label="Reward On Progress"
                amount={slip.earnings.rewardOnProgress}
              />
              <MoneyRow label="Rewards" amount={slip.earnings.rewards} />
              <MoneyRow
                label="Other Allowance"
                amount={slip.earnings.otherAllowance}
              />
              <MoneyRow label="Fuel" amount={slip.earnings.fuel} />
              <MoneyRow
                label="Mobile Load"
                amount={slip.earnings.mobileLoad}
              />
              <MoneyRow
                label="Stipend & Other Allowances"
                amount={earningsTotal}
                bold
              />
            </tbody>
          </table>

          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-black/5">
                <th className="border border-black/30 px-2 py-1 text-left text-xs font-semibold">
                  Deduction
                </th>
                <th className="border border-black/30 px-2 py-1 text-right text-xs font-semibold">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              <MoneyRow label="Advance" amount={slip.deductions.advance} />
              <MoneyRow label="Loan" amount={slip.deductions.loan} />
              <MoneyRow
                label="Mobile Load"
                amount={slip.deductions.mobileLoad}
              />
              <MoneyRow label="Absence" amount={slip.deductions.absence} />
              <MoneyRow label="Fine" amount={slip.deductions.fine} />
              <MoneyRow label="Health" amount={slip.deductions.health} />
              <MoneyRow
                label="Provident Fund"
                amount={slip.deductions.providentFund ?? 0}
              />
              <MoneyRow label="Tax" amount={slip.deductions.tax ?? 0} />
              <MoneyRow label="Other" amount={slip.deductions.other ?? 0} />
              <MoneyRow label="Deduction" amount={deductionsTotal} bold />
              <MoneyRow label="Net Pay" amount={netPay} bold />
            </tbody>
          </table>
        </div>

        {deductionItems.length > 0 && (
          <div className="mt-3">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-black/5">
                  <th className="border border-black/30 px-2 py-1 text-left text-xs font-semibold">
                    Deduction Reason
                  </th>
                  <th className="border border-black/30 px-2 py-1 text-left text-xs font-semibold">
                    Description
                  </th>
                  <th className="border border-black/30 px-2 py-1 text-right text-xs font-semibold">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {deductionItems.map((d, i) => (
                  <tr key={i}>
                    <td className="border border-black/30 px-2 py-1 text-xs">
                      {d.reason.replace(/_/g, ' ')}
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

        <p className="mt-3 text-xs text-black/70">
          Paid Through: {slip.paidThrough || 'Nil'}
        </p>
        <p className="mt-2 break-words text-xs">
          <span className="font-medium">Amount in words: </span>
          {amountInWords(netPay)}
        </p>
        <p className="mt-2 text-[11px] text-black/70">
          Bank Charges (if any) will be deducted from Stipend by the bank
        </p>

        <div className="mt-8 grid grid-cols-3 gap-2 text-center text-[10px] sm:text-xs">
          <div>
            <div className="mb-6 border-b border-black/40" />
            <p>President YCDO</p>
          </div>
          <div>
            <div className="mb-6 border-b border-black/40" />
            <p>Chairman Admin YCDO</p>
          </div>
          <div>
            <div className="mb-6 border-b border-black/40" />
            <p>Chairman Finance YCDO</p>
          </div>
        </div>
      </div>
    </div>
  )
}
