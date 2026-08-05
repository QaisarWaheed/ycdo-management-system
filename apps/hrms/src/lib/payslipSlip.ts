export interface PayslipSlipData {
  orgName: string
  workPlace: string
  phone: string
  employeeId: string
  cnic: string
  employeeName: string
  department: string
  designation: string
  payPeriod: string
  totalDays: number
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
  }
  totalAmount: number
}

function money(n: number | string | null | undefined): number {
  return Number(n) || 0
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
    .filter((d) => d.reason === 'UNINFORMED_ABSENCE')
    .reduce((s, d) => s + money(d.amount), 0)
  const fineEntries = deductions
    .filter(
      (d) => d.reason === 'DISCIPLINARY_FINE' || d.reason === 'LATE_ARRIVAL',
    )
    .reduce((s, d) => s + money(d.amount), 0)

  const monthStart = new Date(data.year, data.month - 1, 1)

  return {
    orgName: 'YCDO IT SERVICES and TRAINING INSTITUTE',
    workPlace: emp?.currentBranch?.address || emp?.currentBranch?.name || '',
    phone: emp?.currentBranch?.phone || '',
    employeeId: emp?.employeeCode || '',
    cnic: emp?.cnic || '',
    employeeName: emp?.fullName || '',
    department: emp?.currentDepartment?.name || '',
    designation: emp?.currentDesignation || '',
    payPeriod: monthStart.toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    }),
    totalDays: new Date(data.year, data.month, 0).getDate(),
    dutyHoursPerDay: emp?.dutyTotalHours ?? 8,
    presence: 0,
    earnings: {
      stipend: money(data.basicStipend),
      previousMonth: 0,
      rewardOnProgress: money(pkg?.progressReward),
      rewards: money(pkg?.reward),
      otherAllowance: money(pkg?.allowances) + overtime + otherExtra,
      fuel: money(pkg?.fuelAllowance),
      mobileLoad: 0,
      extraDuty,
    },
    deductions: {
      advance: money(pkg?.advanceDeduction),
      loan: money(pkg?.loanDeduction),
      mobileLoad: 0,
      absence,
      fine: money(pkg?.fineDeduction) + fineEntries,
      health: money(pkg?.healthDeduction),
    },
    totalAmount: money(data.netStipend),
  }
}
