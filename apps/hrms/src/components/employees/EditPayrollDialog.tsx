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

function stipendChanged(
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

  const form = useForm<EditPayrollFormValues>({
    resolver: zodResolver(editPayrollSchema),
    defaultValues: {
      joiningDate: originalJoiningDate,
      ...DEFAULT_STIPEND_VALUES,
      effectiveFrom: '',
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
      effectiveFrom: '',
      reason: '',
    })
    setIsIncrement(false)
  }, [open, originalJoiningDate, latestStipend, form])

  const mutation = useMutation({
    mutationFn: async (
      values: EditPayrollFormValues & { isIncrement?: boolean },
    ) => {
      const joiningChanged = values.joiningDate !== originalJoiningDate
      const stipendUpdate =
        latestStipend != null && stipendChanged(values, latestStipend)

      if (!joiningChanged && !stipendUpdate) {
        throw new Error('No changes to save')
      }

      if (stipendUpdate) {
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
          if (!values.effectiveFrom?.trim()) {
            throw new Error('Effective date is required for a salary increment')
          }
          if (!values.reason?.trim()) {
            throw new Error('Reason is required for a salary increment')
          }

          await payrollApi.increment({
            ...packageValues,
            effectiveFrom: values.effectiveFrom,
            reason: values.reason.trim(),
          })
        } else {
          await payrollApi.updateActiveStipend({
            ...packageValues,
            reason: values.reason?.trim() || 'Correct current stipend package',
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
                  Saving updates the current package only. That does not
                  split this month. Tick salary increment only when pay
                  actually changes from a chosen date (prefer the 1st of
                  a month).
                </p>
                <StipendPackageFields control={form.control} watch={form.watch} />

                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={isIncrement}
                    onChange={(e) => setIsIncrement(e.target.checked)}
                  />
                  <span>
                    This is a salary increment from a new date (starts a
                    new package)
                  </span>
                </label>

                {isIncrement ? (
                  <>
                    <FormField
                      control={form.control}
                      name="effectiveFrom"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Increment starts on</FormLabel>
                          <FormControl>
                            <DateInput
                              value={field.value ?? ''}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              name={field.name}
                              ref={field.ref}
                            />
                          </FormControl>
                          {field.value && !field.value.endsWith('-01') ? (
                            <p className="text-xs text-amber-800">
                              A date that is not the 1st splits that
                              month&apos;s basic. Use the 1st unless pay
                              really changes mid-month.
                            </p>
                          ) : (
                            <p className="text-xs text-text-secondary">
                              Prefer the 1st of the month so the whole
                              month uses the new package.
                            </p>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="reason"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Reason for increment</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="e.g. Annual increment" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                ) : null}
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
