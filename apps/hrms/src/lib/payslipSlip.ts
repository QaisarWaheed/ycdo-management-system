export interface PayslipSlipData {
  orgName: string
  title: string
  hospital: string
  workPlace: string
  phone: string
  employeeId: string
  cnic: string
  employeeName: string
  department: string
  designation: string
  period: string
  payPeriod: string
  totalDays: number
  leaveDays: number
  paidLeaveDays: number
  unpaidLeaveDays: number
  dutyTime: string
  dutyHoursPerDay: number
  presence: number
  earnings: {
    stipend: number
    previousMonth: number
    rewardOnProgress: number
    rewards: number
    otherAllowance: number
    fuel: number
    mobileLoad: number
    extraDuty: number
  }
  deductions: {
    advance: number
    loan: number
    mobileLoad: number
    absence: number
    fine: number
    health: number
    providentFund: number
    tax: number
    auditDifference: number
    staffPendingMed: number
  }
  earningsTotal: number
  deductionsTotal: number
  netPay: number
  /** @deprecated use netPay */
  totalAmount?: number
  paidThrough: string
}

function money(n: number | string | null | undefined): number {
  return Number(n) || 0
}

function monthTitle(month: number, year: number): string {
  const label = new Date(year, month - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  })
  return `Stipend Slip Month Of ${label}`
}

function periodLabel(month: number, year: number): string {
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0)
  const fmt = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    return `${dd}/${mm}/${d.getFullYear()}`
  }
  return `${fmt(start)} To ${fmt(end)}`
}

/** Build slip layout data from a full payroll entry when API `slip` is absent. */
export function buildPayslipSlipFromEntry(data: {
  month: number
  year: number
  basicStipend: number | string
  netStipend: number | string
  deductions?: Array<{ reason: string; amount: number | string }>
  allowances?: Array<{ type: string; amount: number | string }>
  stipendRecord?: {
    allowances?: number | string | null
    reward?: number | string | null
    progressReward?: number | string | null
    fuelAllowance?: number | string | null
    loanDeduction?: number | string | null
    advanceDeduction?: number | string | null
    fineDeduction?: number | string | null
    healthDeduction?: number | string | null
    employee?: {
      fullName?: string
      employeeCode?: string
      cnic?: string | null
      currentDesignation?: string | null
      dutyStartTime?: string | null
      dutyEndTime?: string | null
      dutyTotalHours?: number | null
      currentBranch?: {
        name?: string
        address?: string | null
        phone?: string | null
      }
      currentDepartment?: { name?: string }
    }
  }
  totalRelieverHours?: number
}): PayslipSlipData {
  const emp = data.stipendRecord?.employee
  const pkg = data.stipendRecord
  const allowances = data.allowances ?? []
  const deductions = data.deductions ?? []

  const extraDuty = allowances
    .filter((a) => a.type === 'ADDITIONAL_WORKING_DAYS')
    .reduce((s, a) => s + money(a.amount), 0)
  const overtime = allowances
    .filter((a) => a.type === 'OVERTIME')
    .reduce((s, a) => s + money(a.amount), 0)
  const otherExtra = allowances
    .filter(
      (a) => a.type !== 'ADDITIONAL_WORKING_DAYS' && a.type !== 'OVERTIME',
    )
    .reduce((s, a) => s + money(a.amount), 0)

  const absence = deductions
    .filter(
      (d) =>
        d.reason === 'UNINFORMED_ABSENCE' ||
        d.reason === 'UNPAID_LEAVE' ||
        d.reason === 'HALF_DAY',
    )
    .reduce((s, d) => s + money(d.amount), 0)
  const fineEntries = deductions
    .filter(
      (d) => d.reason === 'DISCIPLINARY_FINE' || d.reason === 'LATE_ARRIVAL',
    )
    .reduce((s, d) => s + money(d.amount), 0)

  const payPeriod = new Date(data.year, data.month - 1, 1).toLocaleString(
    'en-US',
    { month: 'long', year: 'numeric' },
  )

  const earnings = {
    stipend: money(data.basicStipend),
    previousMonth: 0,
    rewardOnProgress: money(pkg?.progressReward),
    rewards: money(pkg?.reward),
    otherAllowance: money(pkg?.allowances) + overtime + otherExtra,
    fuel: money(pkg?.fuelAllowance),
    mobileLoad: 0,
    extraDuty,
  }

  const deductionsBlock = {
    advance: money(pkg?.advanceDeduction),
    loan: money(pkg?.loanDeduction),
    mobileLoad: 0,
    absence,
    fine: money(pkg?.fineDeduction) + fineEntries,
    health: money(pkg?.healthDeduction),
    providentFund: 0,
    tax: 0,
    auditDifference: 0,
    staffPendingMed: 0,
  }

  const earningsTotal =
    earnings.stipend +
    earnings.previousMonth +
    earnings.rewardOnProgress +
    earnings.rewards +
    earnings.otherAllowance +
    earnings.fuel +
    earnings.mobileLoad +
    earnings.extraDuty

  const deductionsTotal =
    deductionsBlock.advance +
    deductionsBlock.loan +
    deductionsBlock.mobileLoad +
    deductionsBlock.absence +
    deductionsBlock.fine +
    deductionsBlock.health +
    deductionsBlock.providentFund +
    deductionsBlock.tax +
    deductionsBlock.auditDifference +
    deductionsBlock.staffPendingMed

  const netPay = money(data.netStipend)
  const dutyTime =
    emp?.dutyStartTime && emp?.dutyEndTime
      ? `${emp.dutyStartTime} To ${emp.dutyEndTime}`
      : 'Nil'

  return {
    orgName: 'Youth Community Development Organization',
    title: monthTitle(data.month, data.year),
    hospital: emp?.currentBranch?.name || '',
    workPlace: emp?.currentBranch?.address || emp?.currentBranch?.name || '',
    phone: emp?.currentBranch?.phone || '',
    employeeId: emp?.employeeCode || '',
    cnic: emp?.cnic || '',
    employeeName: emp?.fullName || '',
    department: emp?.currentDepartment?.name || '',
    designation: emp?.currentDesignation || '',
    period: periodLabel(data.month, data.year),
    payPeriod,
    totalDays: new Date(data.year, data.month, 0).getDate(),
    leaveDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    dutyTime,
    dutyHoursPerDay: emp?.dutyTotalHours ?? 8,
    presence: 0,
    earnings,
    deductions: deductionsBlock,
    earningsTotal,
    deductionsTotal,
    netPay,
    totalAmount: netPay,
    paidThrough: 'Nil',
  }
}
