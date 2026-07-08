export interface StipendPackageInput {
  basicStipend: number;
  allowances?: number;
  reward?: number;
  progressReward?: number;
  fuelAllowance?: number;
  loanDeduction?: number;
  advanceDeduction?: number;
  fineDeduction?: number;
  healthDeduction?: number;
}

export function calculateLumpsumTotal(values: StipendPackageInput): number {
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
  );
}

export function stipendRecordToPackage(record: {
  basicStipend: unknown;
  allowances?: unknown;
  reward?: unknown;
  progressReward?: unknown;
  fuelAllowance?: unknown;
  loanDeduction?: unknown;
  advanceDeduction?: unknown;
  fineDeduction?: unknown;
  healthDeduction?: unknown;
  lumpsumTotal?: unknown;
}): StipendPackageInput & { lumpsumTotal: number } {
  const pkg: StipendPackageInput = {
    basicStipend: Number(record.basicStipend) || 0,
    allowances: Number(record.allowances ?? 0),
    reward: Number(record.reward ?? 0),
    progressReward: Number(record.progressReward ?? 0),
    fuelAllowance: Number(record.fuelAllowance ?? 0),
    loanDeduction: Number(record.loanDeduction ?? 0),
    advanceDeduction: Number(record.advanceDeduction ?? 0),
    fineDeduction: Number(record.fineDeduction ?? 0),
    healthDeduction: Number(record.healthDeduction ?? 0),
  };

  return {
    ...pkg,
    lumpsumTotal:
      record.lumpsumTotal != null
        ? Number(record.lumpsumTotal)
        : calculateLumpsumTotal(pkg),
  };
}
