import type React from 'react'
import { employeeStatusLabel } from '@/lib/employeeStatus'
import type { PayslipSlipData } from '@/lib/payslipSlip'
import { cn } from '@/lib/utils'

function fmt(amount: number): string {
  if (!amount) return 'Nil'
  return amount.toLocaleString('en-PK')
}

function dayCount(amount: number, stipend: number, totalDays: number): number {
  if (!amount || !stipend || !totalDays) return 0
  return Math.round(amount / (stipend / totalDays))
}

/**
 * One payslip matching the YCDO stipend slip format:
 * yellow header, 4-col info table, 5-col main table, 3 signatures.
 * `compact` prop is used for 3-per-A4-page print layout.
 */
export function PayslipDocument({
  slip,
  compact = false,
}: {
  slip: PayslipSlipData
  compact?: boolean
}) {
  // API slips carry grouped sections with notes → the new compact slip.
  if (slip.sections) return <SectionedPayslip slip={slip} compact={compact} />
  const netPay = slip.netPay ?? slip.totalAmount ?? 0
  const d = slip.deductions

  // Earnings rows (fixed 7 items; row 8 is blank on earnings side)
  const extraDayCount = dayCount(slip.earnings.extraDuty, slip.earnings.stipend, slip.totalDays)
  const fineDayCount = dayCount(d.fine, slip.earnings.stipend, slip.totalDays)

  const earningsData = [
    { label: 'Actual Basic Stipend', amount: slip.earnings.contractualStipend ?? slip.earnings.stipend },
    { label: 'Basic Stipend', amount: slip.earnings.stipend },
    {
      label: extraDayCount > 0
        ? `Extra Days  ${String(extraDayCount).padStart(2, '0')} Day`
        : 'Extra Days',
      amount: slip.earnings.extraDuty,
    },
    { label: 'Reward On Progress', amount: slip.earnings.rewardOnProgress },
    { label: 'Previous Month', amount: slip.earnings.previousMonth },
    { label: 'Reward', amount: slip.earnings.rewards },
    { label: 'Petrol', amount: slip.earnings.fuel },
    { label: 'Travelling Exp', amount: slip.earnings.otherAllowance },
  ]

  const deductionsData = [
    { label: 'Advance', amount: (d.advance ?? 0) + (d.loan ?? 0) },
    { label: 'Staff Pending Med', amount: d.staffPendingMed ?? 0 },
    { label: 'Mobile Load', amount: d.mobileLoad ?? 0 },
    { label: 'Absence', amount: d.absence ?? 0 },
    {
      label: fineDayCount > 0
        ? `Fine  ${String(fineDayCount).padStart(2, '0')} Days`
        : 'Fine',
      amount: d.fine ?? 0,
    },
    { label: 'Health', amount: d.health ?? 0 },
    { label: 'Late Hour', amount: d.lateHour ?? 0 },
    { label: 'Tex', amount: d.tax ?? 0 },
  ]

  // Split paidThrough into lines for the Paid Through column
  const paidLines = (slip.paidThrough || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  // earningsData[0] is the display-only contractual row; skip it in the fallback sum
  const earningsTotal =
    slip.earningsTotal ??
    earningsData.slice(1).reduce((s, r) => s + r.amount, 0)
  const deductionsTotal =
    slip.deductionsTotal ??
    deductionsData.reduce((s, r) => s + r.amount, 0)

  // Legacy client-built slips (no API sections): fixed rows.
  type Row = { label: string; amount: number | null; heading?: boolean }
  const leftRows: Row[] = earningsData
  const rightRows: Row[] = deductionsData
  const ROW_COUNT = Math.max(leftRows.length, rightRows.length, 1)
  const money = (amount: number | null) => (amount == null ? '' : fmt(amount))

  const fs = compact
    ? { base: '8pt', sm: '7.5pt', hdr: '8.5pt', title: '9pt', org: '10pt', sig: '7pt' }
    : { base: '10pt', sm: '9.5pt', hdr: '10.5pt', title: '11.5pt', org: '13pt', sig: '9pt' }

  const cell = (extra = '') =>
    cn(
      'border border-black px-[3px] align-middle',
      compact ? 'py-[1px]' : 'py-[2px]',
      extra,
    )

  return (
    <div
      className={cn(
        'print-content bg-white text-black',
        compact
          ? 'payslip-compact h-full'
          : 'mx-auto max-w-[820px] overflow-x-auto p-2',
      )}
      style={{ fontFamily: 'Arial, sans-serif', fontSize: fs.base }}
    >
      <div
        className={cn(
          'border border-black',
          compact ? 'flex h-full flex-col p-[3px]' : 'p-2',
        )}
        style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties}
      >
        {/* ── Yellow header ── */}
        <div
          className="mb-[2px] text-center font-bold"
          style={{ background: '#FFFF00', padding: compact ? '2px 4px' : '4px 8px' }}
        >
          <div style={{ fontSize: fs.org, fontWeight: 'bold', textTransform: 'uppercase' }}>
            {slip.orgName || 'Youth Community Development Organization'}
          </div>
          <div style={{ fontSize: fs.title, marginTop: '1px' }}>{slip.title}</div>
        </div>

        {/* ── Info table ── */}
        <table
          className="w-full border-collapse"
          style={{ fontSize: fs.base, marginBottom: compact ? '2px' : '3px' }}
        >
          <tbody>
            <tr>
              <td className={cell('font-semibold w-[13%]')}>CNIC</td>
              <td className={cell('w-[27%]')}>{slip.cnic || '—'}</td>
              <td className={cell('font-semibold w-[13%]')}>Hospital</td>
              <td className={cell('w-[47%]')}>{slip.hospital || slip.workPlace || '—'}</td>
            </tr>
            <tr>
              <td className={cell('font-semibold')}>Name</td>
              <td className={cell()}>{slip.employeeName || '—'}</td>
              <td className={cell('font-semibold')}>Work Plac</td>
              <td className={cell()}>{slip.workPlace || '—'}</td>
            </tr>
            <tr>
              <td className={cell('font-semibold')}>Designation</td>
              <td className={cell()}>{slip.designation || '—'}</td>
              <td className={cell('font-semibold')}>Period</td>
              <td className={cell()}>{slip.period || slip.payPeriod || '—'}</td>
            </tr>
            <tr>
              <td className={cell('font-semibold')}>Total Day</td>
              <td className={cell('font-semibold')}>
                Status{' '}
                <span style={{ fontWeight: 'bold', textTransform: 'uppercase' }}>
                  {slip.employeeStatus ? employeeStatusLabel(slip.employeeStatus) : '—'}
                </span>
              </td>
              <td className={cell('font-semibold')}>Time</td>
              <td className={cell()}>{slip.dutyTime || '—'}</td>
            </tr>
            <tr>
              <td className={cell('text-center tabular-nums')}>{slip.totalDays}</td>
              <td className={cell('font-semibold')}>Leave  <span className="tabular-nums">{slip.leaveDays ?? 0}</span></td>
              <td className={cell('font-semibold')}>Presence</td>
              <td className={cell('tabular-nums')}>{slip.presence ?? 0}</td>
            </tr>
          </tbody>
        </table>

        {/* ── Main 5-column table ── */}
        <table
          className="w-full border-collapse"
          style={{ fontSize: fs.base, flex: 1 }}
        >
          <thead>
            <tr style={{ background: '#FFFF00', fontWeight: 'bold' }}>
              <th className={cell('text-left w-[26%]')}>Pay &amp; Allowances</th>
              <th className={cell('text-right w-[12%]')}>Amount</th>
              <th className={cell('text-left w-[20%]')}>Deduction</th>
              <th className={cell('text-right w-[12%]')}>Amount</th>
              <th className={cell('text-left w-[30%]')}>Paid Through</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROW_COUNT }).map((_, i) => {
              const earn = leftRows[i]
              const ded = rightRows[i]
              const paidLine = paidLines[i] ?? ''
              return (
                <tr key={i}>
                  <td className={cell()}>{earn?.label ?? ''}</td>
                  <td className={cell('text-right tabular-nums')}>
                    {earn ? money(earn.amount) : ''}
                  </td>
                  {ded?.heading ? (
                    <td
                      className={cell('font-bold')}
                      colSpan={2}
                      style={{ background: '#FFF7B0' }}
                    >
                      {ded.label}
                    </td>
                  ) : (
                    <>
                      <td className={cell()}>{ded?.label ?? ''}</td>
                      <td className={cell('text-right tabular-nums')}>
                        {ded ? money(ded.amount) : ''}
                      </td>
                    </>
                  )}
                  <td className={cell()}>{paidLine}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 'bold' }}>
              <td className={cell()}>Stipend &amp; Other Allowance</td>
              <td className={cell('text-right tabular-nums')}>{fmt(earningsTotal)}</td>
              <td className={cell()}>Deduction</td>
              <td className={cell('text-right tabular-nums')}>{fmt(deductionsTotal)}</td>
              <td className={cell()}>Net Pay&nbsp;&nbsp;&nbsp;{fmt(netPay)}</td>
            </tr>
          </tfoot>
        </table>

        {/* ── Bank note ── */}
        <p
          className="text-black/80"
          style={{ fontSize: fs.sig, margin: compact ? '1px 0' : '2px 0' }}
        >
          Bank Charges (if any) will be deducted from Stipend by the bank
        </p>

        {/* ── Signatures ── */}
        <div
          className="grid grid-cols-3 gap-1 text-center"
          style={{ fontSize: fs.sig, marginTop: compact ? '4px' : '10px' }}
        >
          {['President YCDO', 'Chairman Admin YCDO', 'Chairman Finance YCDO'].map(
            (signatory) => (
              <div key={signatory}>
                <div
                  className="border-b border-black/40"
                  style={{ marginBottom: compact ? '2px' : '4px' }}
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

const pkr = (n: number) => Math.round(n).toLocaleString('en-PK')

/**
 * Compact slip (two per A4) with large type: photo, name and status up top,
 * every line with what it is for, Net Pay the most prominent figure.
 */
function SectionedPayslip({ slip, compact }: { slip: PayslipSlipData; compact: boolean }) {
  const sections = slip.sections ?? []
  const earnings = sections.find((s) => s.key === 'earnings')?.lines ?? []
  const deductionGroups = sections.filter((s) => s.key !== 'earnings' && s.lines.length > 0)
  const earningsTotal = slip.earningsTotal ?? earnings.reduce((s, l) => s + l.amount, 0)
  const deductionsTotal =
    slip.deductionsTotal ??
    deductionGroups.reduce((s, g) => s + g.lines.reduce((t, l) => t + l.amount, 0), 0)
  const netPay = slip.netPay ?? slip.totalAmount ?? earningsTotal - deductionsTotal
  const status = slip.employeeStatus ? employeeStatusLabel(slip.employeeStatus) : ''
  const active = (slip.employeeStatus ?? '').toUpperCase() === 'ACTIVE'
  const f = compact
    ? { base: '12pt', note: '9.5pt', name: '18pt', head: '12.5pt', net: '19pt', small: '8.5pt', photo: 28 }
    : { base: '11.5pt', note: '9pt', name: '18pt', head: '12.5pt', net: '18pt', small: '8.5pt', photo: 30 }
  const band = { background: '#FFFF00', padding: '0 4px', fontSize: f.head }

  const Line = ({ label, amount, note }: { label: string; amount: number; note?: string }) => (
    <div className="flex items-baseline justify-between gap-2 border-b border-black/15 py-[1px]">
      <div className="min-w-0">
        <span className="font-semibold">{label}</span>
        {note ? (
          <span className="ml-1 italic text-black/70" style={{ fontSize: f.note }}>
            — {note}
          </span>
        ) : null}
      </div>
      <span className="shrink-0 font-semibold tabular-nums">{pkr(amount)}</span>
    </div>
  )

  return (
    <div
      className={cn(
        'print-content bg-white text-black',
        compact ? 'payslip-compact h-full' : 'mx-auto max-w-[820px] p-2',
      )}
      style={{ fontFamily: 'Arial, sans-serif', fontSize: f.base, lineHeight: 1.25 }}
    >
      <div
        className={cn('flex flex-col border-2 border-black', compact ? 'h-full p-[5px]' : 'p-3')}
        style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties}
      >
        <div className="text-center font-bold" style={{ background: '#FFFF00', padding: '2px 6px' }}>
          <div style={{ fontSize: f.head, textTransform: 'uppercase' }}>
            {slip.orgName || 'Youth Community Development Organization'}
          </div>
          <div style={{ fontSize: f.base }}>{slip.title}</div>
        </div>

        <div className="mt-[4px] flex gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold leading-tight" style={{ fontSize: f.name }}>
                {slip.employeeName || '—'}
              </span>
              {status ? (
                <span
                  className="rounded border-2 px-2 font-bold uppercase"
                  style={{
                    fontSize: f.base,
                    borderColor: active ? '#15803d' : '#b91c1c',
                    color: active ? '#15803d' : '#b91c1c',
                  }}
                >
                  {status}
                </span>
              ) : null}
            </div>
            <div className="font-semibold">
              {slip.designation || '—'}
              {slip.hospital || slip.workPlace ? ` · ${slip.hospital || slip.workPlace}` : ''}
            </div>
            <div className="mt-[2px] grid grid-cols-2 gap-x-4" style={{ fontSize: f.note }}>
              <div>
                <b>CNIC:</b> {slip.cnic || '—'}
              </div>
              <div>
                <b>Period:</b> {slip.period || slip.payPeriod || '—'}
              </div>
              <div>
                <b>Duty:</b> {slip.dutyTime || '—'}
              </div>
              <div>
                <b>Days:</b> {slip.totalDays} · <b>Present</b> {slip.presence ?? 0} ·{' '}
                <b>Leave</b> {slip.leaveDays ?? 0}
              </div>
            </div>
          </div>
          <div
            className="shrink-0 overflow-hidden border-2 border-black bg-black/5"
            style={{ width: `${f.photo}mm`, height: `${f.photo * 1.2}mm` }}
          >
            {slip.photoUrl ? (
              <img src={slip.photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div
                className="flex h-full items-center justify-center text-center text-black/40"
                style={{ fontSize: f.small }}
              >
                No photo
              </div>
            )}
          </div>
        </div>

        <div className="mt-[4px] grid flex-1 grid-cols-2 gap-3">
          <div>
            <div className="mb-[2px] font-bold" style={band}>
              Pay &amp; Allowances
            </div>
            {earnings.map((l, i) => (
              <Line key={`e${i}`} {...l} />
            ))}
          </div>
          <div>
            <div className="mb-[2px] font-bold" style={band}>
              Deductions
            </div>
            {deductionGroups.length === 0 ? <div className="italic text-black/60">None</div> : null}
            {deductionGroups.map((g) => (
              <div key={g.key} className="mb-[2px]">
                <div className="font-bold uppercase text-black/70" style={{ fontSize: f.note }}>
                  {g.title}
                </div>
                {g.lines.map((l, i) => (
                  <Line key={`${g.key}${i}`} {...l} />
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-[4px] grid grid-cols-3 items-center border-2 border-black text-center font-bold">
          <div className="border-r-2 border-black py-[2px]">
            <div style={{ fontSize: f.note }}>Gross Pay</div>
            <div className="tabular-nums">{pkr(earningsTotal)}</div>
          </div>
          <div className="border-r-2 border-black py-[2px]">
            <div style={{ fontSize: f.note }}>Deductions</div>
            <div className="tabular-nums">{pkr(deductionsTotal)}</div>
          </div>
          <div className="py-[2px]" style={{ background: '#FFFF00' }}>
            <div style={{ fontSize: f.note }}>NET PAY</div>
            <div className="tabular-nums" style={{ fontSize: f.net }}>
              PKR {pkr(netPay)}
            </div>
          </div>
        </div>

        <div className="mt-[2px] flex justify-between gap-2" style={{ fontSize: f.small }}>
          <span>
            Paid through:{' '}
            {slip.paidThrough && slip.paidThrough !== 'Nil' ? slip.paidThrough : '—'}
          </span>
          <span>Bank charges (if any) will be deducted from stipend by the bank</span>
        </div>
        <div className="mt-[6px] grid grid-cols-3 gap-2 text-center" style={{ fontSize: f.small }}>
          {['President YCDO', 'Chairman Admin YCDO', 'Chairman Finance YCDO'].map((s) => (
            <div key={s}>
              <div
                className="mb-[2px] border-b border-black/50"
                style={{ height: compact ? '10px' : '18px' }}
              />
              {s}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
