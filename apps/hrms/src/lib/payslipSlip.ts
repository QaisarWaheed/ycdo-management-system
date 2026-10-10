export interface PayslipSection {
  key: 'earnings' | 'attendance' | 'discipline' | 'other'
  title: string
  /** note = what the line is for (days, hours, reason). */
  lines: Array<{ label: string; amount: number; note?: string }>
}

/** Where every calendar day went (API slips); counts in days. */
export interface PayslipDayBreakdown {
  totalDays: number
  beforeJoining: number
  joinedOn?: string
  afterExit: number
  exitOn?: string
  present: number
  late: number
  halfDay: number
  shortLeave: number
  swapCovered: number
  holiday: number
  paidLeave: number
  unpaidLeave: number
  absent: number
  uninformedAbsent: number
  notMarked: number
  upcoming: number
  paidDays: number
}

/** Day boxes for the slip header: non-zero only, Present includes late days. */
export function payslipDayCells(b: PayslipDayBreakdown) {
  const cells: Array<{ label: string; value: number; strong?: boolean }> = [
    { label: 'Month', value: b.totalDays },
    { label: b.joinedOn ? `Before joining (${b.joinedOn})` : 'Before joining', value: b.beforeJoining },
    { label: b.exitOn ? `After leaving (${b.exitOn})` : 'After leaving', value: b.afterExit },
    { label: 'Present', value: b.present + b.late + b.shortLeave + b.swapCovered },
    { label: 'of which late', value: b.late },
    { label: 'Half day', value: b.halfDay },
    { label: 'Holiday / off', value: b.holiday },
    { label: 'Paid leave', value: b.paidLeave },
    { label: 'Unpaid leave', value: b.unpaidLeave },
    { label: 'Absent', value: b.absent },
    { label: 'Uninformed absent', value: b.uninformedAbsent },
    { label: 'Not marked', value: b.notMarked },
    { label: 'Not yet', value: b.upcoming },
  ]
  return [
    ...cells.filter((c, i) => i === 0 || c.value > 0),
    { label: 'Paid days', value: b.paidDays, strong: true },
  ]
}

export interface PayslipSlipData {
  /** Where every day of the month went (API slips). */
  dayDetails?: { breakdown: PayslipDayBreakdown }
  /** Grouped, non-empty lines from the API (new layout). Absent on client-built slips. */
  sections?: PayslipSection[]
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
  /** Employee.status (e.g. ACTIVE, ON_REST); absent on slips from older API builds */
  employeeStatus?: string
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
    contractualStipend: number
    previousMonth: number
    rewardOnProgress: number
    rewards: number
    otherAllowance: number
    fuel: number
    mobileLoad: number
    extraDuty: number
  }
  /** Employee photo for the slip header. */
  photoUrl?: string | null
  deductions: {
    /** Basic for days not paid; slip Basic is the full contract. */
    unpaidBasic?: number
    advance: number
    loan: number
    mobileLoad: number
    absence: number
    fine: number
    lateHour: number
    health: number
    providentFund: number
    tax: number
    auditDifference: number
    staffPendingMed: number
    kitchenPending?: number
    electricityBill?: number
    mobileBill?: number
    other: number
  }
  deductionItems: Array<{
    reason: string
    description: string | null
    amount: number
  }>
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
  deductions?: Array<{ reason: string; amount: number | string; description?: string | null }>
  allowances?: Array<{ type: string; amount: number | string }>
  stipendRecord?: {
    basicStipend?: number | string | null
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
      status?: string | null
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
    .filter(
      (a) => a.type === 'ADDITIONAL_WORKING_DAYS' || a.type === 'RELIEVER',
    )
    .reduce((s, a) => s + money(a.amount), 0)
  const overtime = allowances
    .filter((a) => a.type === 'OVERTIME')
    .reduce((s, a) => s + money(a.amount), 0)
  const otherExtra = allowances
    .filter(
      (a) =>
        a.type !== 'ADDITIONAL_WORKING_DAYS' &&
        a.type !== 'RELIEVER' &&
        a.type !== 'OVERTIME',
    )
    .reduce((s, a) => s + money(a.amount), 0)

  const absence = deductions
    .filter(
      (d) =>
        d.reason === 'UNINFORMED_ABSENCE' ||
        d.reason === 'UNPAID_LEAVE' ||
        d.reason === 'HALF_DAY' ||
        (d.reason === 'OTHER' &&
          (d.description ?? '').startsWith('Unmarked day')),
    )
    .reduce((s, d) => s + money(d.amount), 0)
  const fineEntries = deductions
    .filter(
      (d) =>
        d.reason === 'DISCIPLINARY_FINE' ||
        d.reason === 'FINE',
    )
    .reduce((s, d) => s + money(d.amount), 0)
  const lateHourEntries = deductions
    .filter((d) => d.reason === 'LATE_ARRIVAL')
    .reduce((s, d) => s + money(d.amount), 0)
  const sumReason = (reason: string) =>
    deductions
      .filter((d) => d.reason === reason)
      .reduce((s, d) => s + money(d.amount), 0)
  const loanEntries = deductions
    .filter((d) => d.reason === 'LOAN')
    .reduce((s, d) => s + money(d.amount), 0)
  const advanceEntries = deductions
    .filter((d) => d.reason === 'ADVANCE')
    .reduce((s, d) => s + money(d.amount), 0)
  const categorizedDeductions = new Set(
    deductions.filter(
      (d) =>
        d.reason === 'UNINFORMED_ABSENCE' ||
        d.reason === 'UNPAID_LEAVE' ||
        d.reason === 'HALF_DAY' ||
        (d.reason === 'OTHER' &&
          (d.description ?? '').startsWith('Unmarked day')) ||
        d.reason === 'DISCIPLINARY_FINE' ||
        d.reason === 'LATE_ARRIVAL' ||
        d.reason === 'FINE' ||
        d.reason === 'LOAN' ||
        d.reason === 'ADVANCE' ||
        d.reason === 'MEDICINE_PENDING' ||
        d.reason === 'KITCHEN_PENDING' ||
        d.reason === 'ELECTRICITY_BILL' ||
        d.reason === 'MOBILE_BILL'
    ),
  )
  const otherDeduction = deductions
    .filter((d) => !categorizedDeductions.has(d))
    .reduce((s, d) => s + money(d.amount), 0)
  const deductionItems = deductions.map((d) => ({
    reason: d.reason,
    description: d.description ?? null,
    amount: money(d.amount),
  }))

  const payPeriod = new Date(data.year, data.month - 1, 1).toLocaleString(
    'en-US',
    { month: 'long', year: 'numeric' },
  )

  const earnings = {
    stipend: money(data.basicStipend),
    contractualStipend: money(pkg?.basicStipend) || money(data.basicStipend),
    previousMonth: 0,
    rewardOnProgress: money(pkg?.progressReward),
    rewards: money(pkg?.reward),
    otherAllowance: money(pkg?.allowances) + overtime + otherExtra,
    fuel: money(pkg?.fuelAllowance),
    mobileLoad: 0,
    extraDuty,
  }

  const deductionsBlock = {
    advance: money(pkg?.advanceDeduction) + advanceEntries,
    loan: money(pkg?.loanDeduction) + loanEntries,
    mobileLoad: 0,
    absence,
    fine: money(pkg?.fineDeduction) + fineEntries,
    lateHour: lateHourEntries,
    health: money(pkg?.healthDeduction),
    providentFund: 0,
    tax: 0,
    auditDifference: 0,
    staffPendingMed: sumReason('MEDICINE_PENDING'),
    kitchenPending: sumReason('KITCHEN_PENDING'),
    electricityBill: sumReason('ELECTRICITY_BILL'),
    mobileBill: sumReason('MOBILE_BILL'),
    other: otherDeduction,
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
    deductionsBlock.lateHour +
    deductionsBlock.health +
    deductionsBlock.providentFund +
    deductionsBlock.tax +
    deductionsBlock.auditDifference +
    deductionsBlock.staffPendingMed +
    (deductionsBlock.kitchenPending ?? 0) +
    (deductionsBlock.electricityBill ?? 0) +
    (deductionsBlock.mobileBill ?? 0) +
    deductionsBlock.other

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
    employeeStatus: emp?.status || '',
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
    deductionItems,
    earningsTotal,
    deductionsTotal,
    netPay,
    totalAmount: netPay,
    paidThrough: 'Nil',
  }
}
