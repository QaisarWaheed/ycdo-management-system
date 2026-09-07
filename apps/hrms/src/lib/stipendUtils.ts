export interface StipendPackageValues {
  basicStipend: number
  allowances?: number
  reward?: number
  progressReward?: number
  fuelAllowance?: number
  loanDeduction?: number
  advanceDeduction?: number
  fineDeduction?: number
  healthDeduction?: number
}

export function calculateLumpsumTotal(values: StipendPackageValues): number {
  return (
    (values.basicStipend || 0) +
    (values.allowances || 0) +
    (values.reward || 0) +
    (values.progressReward || 0) +
    (values.fuelAllowance || 0) -
    (values.loanDeduction || 0) -
    (values.advanceDeduction || 0) -
    (values.fineDeduction || 0) -
    (values.healthDeduction || 0)
  )
}

export function formatPKR(amount: number | string): string {
  return `PKR ${Number(amount).toLocaleString('en-PK')}`
}

export const DEFAULT_STIPEND_VALUES: StipendPackageValues = {
  basicStipend: 0,
  allowances: 0,
  reward: 0,
  progressReward: 0,
  fuelAllowance: 0,
  loanDeduction: 0,
  advanceDeduction: 0,
  fineDeduction: 0,
  healthDeduction: 0,
}

/** Closed packages are history, even when their start date sorts last. */
export function selectCurrentStipend<T extends { effectiveFrom: string; effectiveTo?: string | null }>(records: T[]): T | undefined {
  return records.filter(record => record.effectiveTo === null)
    .sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime())[0]
}
