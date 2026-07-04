import type { Control, FieldValues, Path } from 'react-hook-form'
import { PKRInput } from '@/components/common/PKRInput'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { calculateLumpsumTotal, formatPKR } from '@/lib/stipendUtils'

const EARNING_FIELDS = [
  ['basicStipend', 'Basic Stipend', true],
  ['allowances', 'Allowances', false],
  ['reward', 'Reward', false],
  ['progressReward', 'Reward on Progress (Incentive)', false],
  ['fuelAllowance', 'Petrol (Fuel Allowance)', false],
] as const

const DEDUCTION_FIELDS = [
  ['loanDeduction', 'Loan Deduction'],
  ['advanceDeduction', 'Advance Deduction'],
  ['fineDeduction', 'Fine Deduction'],
  ['healthDeduction', 'Health Deduction'],
] as const

type StipendPackageFieldsProps<T extends FieldValues> = {
  control: Control<T>
  watch: (names: Path<T>[]) => unknown[]
  basicRequired?: boolean
}

export function StipendPackageFields<T extends FieldValues>({
  control,
  watch,
  basicRequired = true,
}: StipendPackageFieldsProps<T>) {
  const [
    basicStipend,
    allowances,
    reward,
    progressReward,
    fuelAllowance,
    loanDeduction,
    advanceDeduction,
    fineDeduction,
    healthDeduction,
  ] = watch([
    'basicStipend' as Path<T>,
    'allowances' as Path<T>,
    'reward' as Path<T>,
    'progressReward' as Path<T>,
    'fuelAllowance' as Path<T>,
    'loanDeduction' as Path<T>,
    'advanceDeduction' as Path<T>,
    'fineDeduction' as Path<T>,
    'healthDeduction' as Path<T>,
  ]) as number[]

  const lumpsum = calculateLumpsumTotal({
    basicStipend: Number(basicStipend) || 0,
    allowances: Number(allowances) || 0,
    reward: Number(reward) || 0,
    progressReward: Number(progressReward) || 0,
    fuelAllowance: Number(fuelAllowance) || 0,
    loanDeduction: Number(loanDeduction) || 0,
    advanceDeduction: Number(advanceDeduction) || 0,
    fineDeduction: Number(fineDeduction) || 0,
    healthDeduction: Number(healthDeduction) || 0,
  })

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Earnings</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {EARNING_FIELDS.map(([name, label, required]) => (
            <FormField
              key={name}
              control={control}
              name={name as Path<T>}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {label}
                    {(required || basicRequired) && name === 'basicStipend' && (
                      <span className="text-destructive"> *</span>
                    )}
                  </FormLabel>
                  <FormControl>
                    <PKRInput
                      value={Number(field.value) || 0}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Deductions</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {DEDUCTION_FIELDS.map(([name, label]) => (
            <FormField
              key={name}
              control={control}
              name={name as Path<T>}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{label}</FormLabel>
                  <FormControl>
                    <PKRInput
                      value={Number(field.value) || 0}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-text-secondary">Lumpsum Total</p>
        <p className="text-2xl font-bold text-primary">{formatPKR(lumpsum)}</p>
        <p className="mt-1 text-xs text-text-secondary">
          Earnings minus fixed deductions (auto-calculated)
        </p>
      </div>
    </div>
  )
}
