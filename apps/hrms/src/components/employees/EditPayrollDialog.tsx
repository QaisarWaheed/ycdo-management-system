import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { employeesApi } from '@/api/endpoints/employees'
import { payrollApi } from '@/api/endpoints/payroll'
import { DateInput } from '@/components/common/DateInput'
import { StipendPackageFields } from '@/components/payroll/StipendPackageFields'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { DEFAULT_STIPEND_VALUES } from '@/lib/stipendUtils'
import type { StipendRecord } from '@/types'

const stipendFieldSchema = z.number().min(0)

const editPayrollSchema = z.object({
  joiningDate: z.string().min(1, 'Joining date is required'),
  basicStipend: z.number().min(0),
  allowances: stipendFieldSchema,
  reward: stipendFieldSchema,
  progressReward: stipendFieldSchema,
  fuelAllowance: stipendFieldSchema,
  loanDeduction: stipendFieldSchema,
  advanceDeduction: stipendFieldSchema,
  fineDeduction: stipendFieldSchema,
  healthDeduction: stipendFieldSchema,
  effectiveFrom: z.string().optional(),
  reason: z.string().optional(),
})

type EditPayrollFormValues = z.infer<typeof editPayrollSchema>

type EditPayrollDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeId: string
  joiningDate: string
  latestStipend?: StipendRecord
  onSuccess: () => void
}

function toDateInput(value?: string | null) {
  if (!value) return ''
  return value.slice(0, 10)
}

function stipendValuesFromRecord(record: StipendRecord) {
  return {
    basicStipend: Number(record.basicStipend) || 0,
    allowances: Number(record.allowances) || 0,
    reward: Number(record.reward) || 0,
    progressReward: Number(record.progressReward) || 0,
    fuelAllowance: Number(record.fuelAllowance) || 0,
    loanDeduction: Number(record.loanDeduction) || 0,
    advanceDeduction: Number(record.advanceDeduction) || 0,
    fineDeduction: Number(record.fineDeduction) || 0,
    healthDeduction: Number(record.healthDeduction) || 0,
  }
}

function stipendAmountsChanged(
  values: EditPayrollFormValues,
  record: StipendRecord,
): boolean {
  const current = stipendValuesFromRecord(record)
  return (
    values.basicStipend !== current.basicStipend ||
    values.allowances !== current.allowances ||
    values.reward !== current.reward ||
    values.progressReward !== current.progressReward ||
    values.fuelAllowance !== current.fuelAllowance ||
    values.loanDeduction !== current.loanDeduction ||
    values.advanceDeduction !== current.advanceDeduction ||
    values.fineDeduction !== current.fineDeduction ||
    values.healthDeduction !== current.healthDeduction
  )
}

function firstOfMonthIso(isoDate: string): string {
  if (!isoDate || isoDate.length < 7) return isoDate
  return `${isoDate.slice(0, 7)}-01`
}

function firstOfCurrentMonthIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

export function EditPayrollDialog({
  open,
  onOpenChange,
  employeeId,
  joiningDate,
  latestStipend,
  onSuccess,
}: EditPayrollDialogProps) {
  const [isIncrement, setIsIncrement] = useState(false)
  const originalJoiningDate = toDateInput(joiningDate)
  const originalEffectiveFrom = toDateInput(latestStipend?.effectiveFrom)

  const form = useForm<EditPayrollFormValues>({
    resolver: zodResolver(editPayrollSchema),
    defaultValues: {
      joiningDate: originalJoiningDate,
      ...DEFAULT_STIPEND_VALUES,
      effectiveFrom: originalEffectiveFrom,
      reason: '',
    },
  })

  useEffect(() => {
    if (!open) return

    const stipendDefaults = latestStipend
      ? stipendValuesFromRecord(latestStipend)
      : DEFAULT_STIPEND_VALUES

    form.reset({
      joiningDate: originalJoiningDate,
      ...stipendDefaults,
      effectiveFrom: toDateInput(latestStipend?.effectiveFrom),
      reason: '',
    })
    setIsIncrement(false)
  }, [open, originalJoiningDate, latestStipend, form])

  const mutation = useMutation({
    mutationFn: async (
      values: EditPayrollFormValues & { isIncrement?: boolean },
    ) => {
      const joiningChanged = values.joiningDate !== originalJoiningDate
      const amountsChanged =
        latestStipend != null && stipendAmountsChanged(values, latestStipend)
      const effectiveFromChanged =
        latestStipend != null &&
        !!values.effectiveFrom?.trim() &&
        values.effectiveFrom.trim() !== originalEffectiveFrom
      const stipendUpdate = amountsChanged || effectiveFromChanged

      if (!joiningChanged && !stipendUpdate) {
        throw new Error('No changes to save')
      }

      if (stipendUpdate && latestStipend) {
        const packageValues = {
          employeeId,
          basicStipend: values.basicStipend,
          allowances: values.allowances,
          reward: values.reward,
          progressReward: values.progressReward,
          fuelAllowance: values.fuelAllowance,
          loanDeduction: values.loanDeduction,
          advanceDeduction: values.advanceDeduction,
          fineDeduction: values.fineDeduction,
          healthDeduction: values.healthDeduction,
        }

        if (values.isIncrement) {
          const snapped = firstOfMonthIso(
            values.effectiveFrom?.trim() || firstOfCurrentMonthIso(),
          )
          if (!snapped) {
            throw new Error('Effective date is required for a salary increment')
          }
          if (!values.reason?.trim()) {
            throw new Error('Reason is required for a salary increment')
          }

          await payrollApi.increment({
            ...packageValues,
            effectiveFrom: snapped,
            reason: values.reason.trim(),
          })
        } else {
          await payrollApi.updateActiveStipend({
            ...packageValues,
            ...(effectiveFromChanged
              ? { effectiveFrom: values.effectiveFrom!.trim() }
              : {}),
            reason:
              values.reason?.trim() ||
              (effectiveFromChanged
                ? 'Correct package effective date (management order: from month day 1)'
                : 'Correct current stipend package'),
          })
        }
      }

      if (joiningChanged) {
        await employeesApi.update(employeeId, {
          joiningDate: values.joiningDate,
        })
      }
    },
    onSuccess: () => {
      toast({ title: 'Payroll information updated' })
      onSuccess()
      onOpenChange(false)
    },
    onError: (err: Error & { response?: { data?: { message?: string | string[] } } }) => {
      const apiMsg = err.response?.data?.message
      const description = apiMsg
        ? Array.isArray(apiMsg)
          ? apiMsg.join(', ')
          : String(apiMsg)
        : err.message

      toast({
        title: 'Failed to update payroll',
        description,
        variant: 'destructive',
      })
    },
  })

  const watchedEffectiveFrom = form.watch('effectiveFrom')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Payroll & Joining Date</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) =>
              mutation.mutate({ ...values, isIncrement })
            )}
            className="space-y-6"
          >
            <FormField
              control={form.control}
              name="joiningDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Joining Date</FormLabel>
                  <FormControl>
                    <DateInput
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {latestStipend ? (
              <>
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-text-secondary">
                  Saving updates the current package only. Tick salary
                  increment only when pay changes from a new month — the
                  start date is always the <strong>1st</strong> of that
                  month (mid-month dates are snapped to the 1st). To fix a
                  raise saved mid-month, change &quot;Package starts on&quot;
                  to the 1st without ticking increment.
                </p>
                <StipendPackageFields control={form.control} watch={form.watch} />

                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={isIncrement}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setIsIncrement(checked)
                      if (checked) {
                        form.setValue(
                          'effectiveFrom',
                          firstOfCurrentMonthIso(),
                          { shouldDirty: true },
                        )
                      } else {
                        form.setValue(
                          'effectiveFrom',
                          originalEffectiveFrom,
                          { shouldDirty: true },
                        )
                      }
                    }}
                  />
                  <span>
                    This is a salary increment from a new month (starts a
                    new package on the 1st)
                  </span>
                </label>

                <FormField
                  control={form.control}
                  name="effectiveFrom"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {isIncrement
                          ? 'Increment month (always the 1st)'
                          : 'Package starts on'}
                      </FormLabel>
                      <FormControl>
                        <DateInput
                          value={field.value ?? ''}
                          onChange={(v) => {
                            if (isIncrement && v) {
                              field.onChange(firstOfMonthIso(v))
                            } else {
                              field.onChange(v)
                            }
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      {isIncrement ? (
                        <p className="text-xs text-text-secondary">
                          Pick any day in the target month — the system
                          uses the 1st so the whole month uses the new
                          package.
                        </p>
                      ) : field.value && !field.value.endsWith('-01') ? (
                        <div className="space-y-1">
                          <p className="text-xs text-amber-800">
                            A date that is not the 1st splits that
                            month&apos;s basic on regenerate. Use the 1st
                            unless correcting intentionally.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              form.setValue(
                                'effectiveFrom',
                                firstOfMonthIso(field.value ?? ''),
                                { shouldDirty: true },
                              )
                            }
                          >
                            Move to 1st of this month
                          </Button>
                        </div>
                      ) : (
                        <p className="text-xs text-text-secondary">
                          Prefer the 1st of the month so Monthly Payroll
                          matches this package for the whole month.
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {(isIncrement ||
                  (watchedEffectiveFrom &&
                    watchedEffectiveFrom !== originalEffectiveFrom)) && (
                  <FormField
                    control={form.control}
                    name="reason"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {isIncrement
                            ? 'Reason for increment'
                            : 'Reason for date/package correction'}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={
                              isIncrement
                                ? 'e.g. Annual increment'
                                : 'e.g. Management order — raise from month day 1'
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </>
            ) : (
              <p className="text-sm text-text-secondary">
                No stipend record found. Only joining date can be updated.
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-primary hover:bg-primary-dark"
                disabled={mutation.isPending}
              >
                {mutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
