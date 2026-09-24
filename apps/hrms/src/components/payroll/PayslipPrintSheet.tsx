import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { PayslipDocument } from '@/components/payroll/PayslipDocument'
import type { PayslipSlipData } from '@/lib/payslipSlip'

const PER_PAGE = 4

/*
 * Printed only while `body.printing-payslips` is set, so the page's other
 * print views (e.g. the monthly summary report) stay out of the printout.
 * A4 portrait, 6mm margins → 198 × 285mm, split into a 2 × 2 grid.
 */
const PRINT_CSS = `
#payslip-print-root { display: none; }
@media print {
  @page { size: A4 portrait; margin: 6mm; }
  body.printing-payslips > *:not(#payslip-print-root) { display: none !important; }
  body.printing-payslips #payslip-print-root { display: block !important; }
  #payslip-print-root .payslip-print-page {
    width: 198mm;
    height: 285mm;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 3mm;
    break-after: page;
    page-break-after: always;
    overflow: hidden;
  }
  #payslip-print-root .payslip-print-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }
  #payslip-print-root .payslip-print-cell {
    min-height: 0;
    overflow: hidden;
    break-inside: avoid;
  }
  #payslip-print-root * {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`

/**
 * Prints the given payslips four to a page, then calls `onDone`. Mount it only
 * when there is something to print.
 */
export function PayslipPrintSheet({
  slips,
  onDone,
}: {
  slips: PayslipSlipData[]
  onDone: () => void
}) {
  useEffect(() => {
    document.body.classList.add('printing-payslips')
    const finish = () => {
      document.body.classList.remove('printing-payslips')
      onDone()
    }
    window.addEventListener('afterprint', finish, { once: true })
    // Let the sheet paint before the print dialog snapshots the page.
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => window.print()),
    )
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('afterprint', finish)
      document.body.classList.remove('printing-payslips')
    }
  }, [onDone])

  const pages: PayslipSlipData[][] = []
  for (let i = 0; i < slips.length; i += PER_PAGE) {
    pages.push(slips.slice(i, i + PER_PAGE))
  }

  return createPortal(
    <div id="payslip-print-root">
      <style>{PRINT_CSS}</style>
      {pages.map((page, pageIndex) => (
        <div key={pageIndex} className="payslip-print-page">
          {page.map((slip, i) => (
            <div key={i} className="payslip-print-cell">
              <PayslipDocument slip={slip} compact />
            </div>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  )
}
