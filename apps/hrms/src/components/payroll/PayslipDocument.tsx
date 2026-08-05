import { amountInWords } from '@/lib/amountInWords'
import type { PayslipSlipData } from '@/lib/payslipSlip'
import { formatPKR } from '@/lib/stipendUtils'

function fmt(amount: number) {
  return formatPKR(amount)
}

function MetaItem({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="min-w-0 border-b border-black/20 py-1.5 sm:border-0 sm:py-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-black/60 sm:text-xs sm:normal-case sm:tracking-normal sm:text-black">
        {label}
      </p>
      <p className="truncate text-xs sm:mt-0.5">{value || '—'}</p>
    </div>
  )
}

function AmountRow({
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
        {fmt(amount)}
      </td>
    </tr>
  )
}

export function PayslipDocument({ slip }: { slip: PayslipSlipData }) {
  const earningsTotal =
    slip.earnings.stipend +
    slip.earnings.previousMonth +
    slip.earnings.rewardOnProgress +
    slip.earnings.rewards +
    slip.earnings.otherAllowance +
    slip.earnings.fuel +
    slip.earnings.mobileLoad +
    slip.earnings.extraDuty

  const deductionsTotal =
    slip.deductions.advance +
    slip.deductions.loan +
    slip.deductions.mobileLoad +
    slip.deductions.absence +
    slip.deductions.fine +
    slip.deductions.health

  const metaItems = [
    { label: 'Employee ID', value: slip.employeeId },
    { label: 'Work Place', value: slip.workPlace },
    { label: 'CNIC', value: slip.cnic },
    { label: 'Pay Period', value: slip.payPeriod },
    { label: 'Employee Name', value: slip.employeeName },
    { label: 'Total Days', value: slip.totalDays },
    { label: 'Department', value: slip.department },
    { label: 'Duty Hours (Per Day)', value: slip.dutyHoursPerDay },
    { label: 'Designation', value: slip.designation },
    { label: 'Presence', value: slip.presence },
  ]

  return (
    <div className="print-content mx-auto max-w-[720px] overflow-x-auto bg-white p-2 text-black sm:p-4">
      <div className="min-w-0 border border-black p-3 sm:p-4">
        <div className="mb-3 text-center">
          <h2 className="text-sm font-bold uppercase tracking-wide sm:text-base">
            {slip.orgName}
          </h2>
          {slip.workPlace ? (
            <p className="mt-1 break-words text-xs">{slip.workPlace}</p>
          ) : null}
          {slip.phone ? <p className="text-xs">Phone: {slip.phone}</p> : null}
          <p className="mt-2 text-sm font-bold tracking-[0.2em]">PAYSLIP</p>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-x-4 gap-y-0 sm:grid-cols-2 print:grid-cols-2">
          {metaItems.map((item) => (
            <MetaItem key={item.label} label={item.label} value={item.value} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 print:grid-cols-2">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-black/5">
                <th className="border border-black/30 px-2 py-1 text-left text-xs font-semibold">
                  Earnings
                </th>
                <th className="border border-black/30 px-2 py-1 text-right text-xs font-semibold">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              <AmountRow label="Stipend" amount={slip.earnings.stipend} />
              <AmountRow
                label="Previous Month"
                amount={slip.earnings.previousMonth}
              />
              <AmountRow
                label="Reward On Progress"
                amount={slip.earnings.rewardOnProgress}
              />
              <AmountRow label="Rewards" amount={slip.earnings.rewards} />
              <AmountRow
                label="Other Allowance"
                amount={slip.earnings.otherAllowance}
              />
              <AmountRow label="Fuel" amount={slip.earnings.fuel} />
              <AmountRow
                label="Mobile Load"
                amount={slip.earnings.mobileLoad}
              />
              <AmountRow
                label="Extra Duty / Reliever"
                amount={slip.earnings.extraDuty}
              />
              <AmountRow label="Total Earnings" amount={earningsTotal} bold />
            </tbody>
          </table>

          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-black/5">
                <th className="border border-black/30 px-2 py-1 text-left text-xs font-semibold">
                  Deductions
                </th>
                <th className="border border-black/30 px-2 py-1 text-right text-xs font-semibold">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              <AmountRow label="Advance" amount={slip.deductions.advance} />
              <AmountRow label="Loan" amount={slip.deductions.loan} />
              <AmountRow
                label="Mobile Load"
                amount={slip.deductions.mobileLoad}
              />
              <AmountRow label="Absence" amount={slip.deductions.absence} />
              <AmountRow label="Fine" amount={slip.deductions.fine} />
              <AmountRow label="Health" amount={slip.deductions.health} />
              <AmountRow
                label="Total Deductions"
                amount={deductionsTotal}
                bold
              />
              <AmountRow
                label="Total Amount"
                amount={slip.totalAmount}
                bold
              />
            </tbody>
          </table>
        </div>

        <p className="mt-4 break-words text-xs">
          <span className="font-medium">Amount in words: </span>
          {amountInWords(slip.totalAmount)}
        </p>
        <p className="mt-2 text-center text-[11px] italic text-black/70">
          System generated slip and no signature required
        </p>
      </div>
    </div>
  )
}
