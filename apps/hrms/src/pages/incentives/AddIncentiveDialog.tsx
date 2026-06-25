import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { incentivesApi } from '@/api/endpoints/incentives'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
import { PKRInput } from '@/components/common/PKRInput'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'

const schema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  month: z.number().min(1).max(12),
  year: z.number().min(2020),
  amount: z.number().positive('Amount must be greater than 0'),
  reason: z
    .string()
    .min(10, 'Reason must be at least 10 characters')
    .max(1000, 'Reason must be 1000 characters or less'),
})

type FormValues = z.infer<typeof schema>

const currentYear = new Date().getFullYear()
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const YEARS = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i)

export function AddIncentiveDialog({
  open,
  onOpenChange,
  defaultEmployeeId,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultEmployeeId?: string
  onSuccess?: () => void
}) {
  const queryClient = useQueryClient()
  const now = new Date()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      employeeId: defaultEmployeeId ?? '',
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      amount: 0,
      reason: '',
    },
  })

  useEffect(() => {
    if (defaultEmployeeId) {
      form.setValue('employeeId', defaultEmployeeId)
    }
  }, [defaultEmployeeId, form, open])

  const reason = form.watch('reason')

  const mutation = useMutation({
    mutationFn: (values: FormValues) => incentivesApi.create(values),
    onSuccess: () => {
      toast({ title: 'Incentive added successfully' })
      queryClient.invalidateQueries({ queryKey: ['incentives'] })
      form.reset({
        employeeId: defaultEmployeeId ?? '',
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        amount: 0,
        reason: '',
      })
      onOpenChange(false)
      onSuccess?.()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to add incentive',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Incentive</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
          >
            {!defaultEmployeeId && (
              <FormField
                control={form.control}
                name="employeeId"
                render={({ field }) => (
                  <FormItem>
                    <EmployeeSearchSelect
                      value={field.value}
                      onChange={(id) => field.onChange(id)}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="month"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Month *</FormLabel>
                    <Select
                      value={String(field.value)}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MONTHS.map((m) => (
                          <SelectItem key={m} value={String(m)}>
                            {new Date(2000, m - 1).toLocaleString('en', {
                              month: 'long',
                            })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="year"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Year *</FormLabel>
                    <Select
                      value={String(field.value)}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {YEARS.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (PKR) *</FormLabel>
                  <FormControl>
                    <PKRInput value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason for Incentive *</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe the reason for this incentive..."
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <p className="text-xs text-text-secondary">
                    {reason.length}/1000 characters
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Incentives are final once added and automatically reflected in the
              employee&apos;s payroll for the selected month.
            </p>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Adding...' : 'Add Incentive'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
