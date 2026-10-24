import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { incentivesApi } from '@/api/endpoints/incentives'
import type { EmployeeApproverTarget } from '@/api/endpoints/employeeOnboarding'
import {
  allowancesApi,
  isPendingApproval,
  payApprovalsApi,
  type PayChangeRequest,
} from '@/api/endpoints/payApprovals'
import type { Incentive } from '@/types'
import { AddIncentivesForm } from './AddIncentivesForm'
import { ApproverSelect, useNeedsPayApproval } from '@/components/payroll/ApproverSelect'
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
  typeId: z.string().min(1, 'Choose an incentive type'),
  // Optional: the type is printed on the stipend slip; the note goes beside it.
  reason: z.string().trim().max(1000, 'Reason must be 1000 characters or less'),
})

type FormValues = z.infer<typeof schema>

const currentYear = new Date().getFullYear()
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const YEARS = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i)

/** The note part of a stored reason ("On Progress: ward shifting" → "ward shifting"). */
function noteOf(reason: string, typeName?: string) {
  if (!typeName) return reason
  if (reason === typeName) return ''
  return reason.startsWith(`${typeName}: `) ? reason.slice(typeName.length + 2) : reason
}

/**
 * Add an incentive, or fix one: `editIncentive` corrects a saved incentive
 * (a higher amount from Finance goes for approval), `editRequest` corrects
 * an incentive request still waiting for an executive.
 */
export function AddIncentiveDialog({
  open,
  onOpenChange,
  defaultEmployeeId,
  defaultMonth,
  defaultYear,
  onSuccess,
  editIncentive,
  editRequest,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultEmployeeId?: string
  defaultMonth?: number
  defaultYear?: number
  onSuccess?: () => void
  editIncentive?: Incentive | null
  editRequest?: PayChangeRequest | null
}) {
  const requestValues = editRequest?.payload as
    | { amount?: number; typeId?: string; reason?: string; month?: number; year?: number }
    | undefined
  const queryClient = useQueryClient()
  // An incentive picked for editing from the list inside the add form.
  const [localEdit, setLocalEdit] = useState<Incentive | null>(null)
  const activeEdit = editIncentive ?? localEdit
  useEffect(() => {
    if (!open) setLocalEdit(null)
  }, [open])
  const now = new Date()
  const initialMonth = defaultMonth ?? now.getMonth() + 1
  const initialYear = defaultYear ?? now.getFullYear()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      employeeId: defaultEmployeeId ?? '',
      month: initialMonth,
      year: initialYear,
      amount: 0,
      typeId: '',
      reason: '',
    },
  })
  const { data: incentiveTypes = [] } = useQuery({
    queryKey: ['incentive-types'],
    queryFn: allowancesApi.listIncentiveTypes,
    enabled: open,
  })
  const isEdit = !!activeEdit || !!editRequest
  const [approver, setApprover] = useState<EmployeeApproverTarget>()
  const amount = form.watch('amount')
  const originalAmount = activeEdit ? Number(activeEdit.amount) : 0
  // Approval only for a raise: new incentives, a higher amount, or a pending request.
  const needsApproval =
    useNeedsPayApproval() && (!activeEdit || amount > originalAmount)

  useEffect(() => {
    if (!open) return
    if (activeEdit || editRequest) {
      const source = activeEdit ?? {
        employeeId: editRequest!.employeeId,
        amount: requestValues?.amount ?? 0,
        typeId: requestValues?.typeId,
        reason: requestValues?.reason ?? '',
        month: requestValues?.month ?? initialMonth,
        year: requestValues?.year ?? initialYear,
      }
      const typeName = incentiveTypes.find((t) => t.id === source.typeId)?.name
      form.reset({
        employeeId: source.employeeId,
        month: source.month,
        year: source.year,
        amount: Number(source.amount),
        typeId: source.typeId ?? '',
        // Saved incentives store "Type: note"; requests store the note alone.
        reason: activeEdit ? noteOf(source.reason, typeName) : source.reason,
      })
      setApprover(editRequest?.approverTarget)
      return
    }
    if (defaultEmployeeId) {
      form.setValue('employeeId', defaultEmployeeId)
    }
    form.setValue('month', initialMonth)
    form.setValue('year', initialYear)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultEmployeeId, initialMonth, initialYear, form, open, activeEdit, editRequest, incentiveTypes])

  const reason = form.watch('reason')

  const mutation = useMutation({
    mutationFn: (values: FormValues): Promise<unknown> => {
      const { employeeId, ...rest } = values
      const body = { ...rest, reason: values.reason.trim() || undefined }
      if (editRequest) {
        return payApprovalsApi.editIncentive(editRequest.id, { ...body, approverTarget: approver! })
      }
      if (activeEdit) {
        return incentivesApi.update(activeEdit.id, {
          ...body,
          approverTarget: needsApproval ? approver : undefined,
        })
      }
      return incentivesApi.create({ ...body, employeeId, approverTarget: approver })
    },
    onSuccess: (res) => {
      toast({
        title: isPendingApproval(res)
          ? `Sent to ${res.approverLabel} for approval`
          : editRequest
            ? 'Request updated; still waiting for approval'
            : activeEdit
              ? 'Incentive updated'
              : 'Incentive added successfully',
      })
      queryClient.invalidateQueries({ queryKey: ['incentives'] })
      queryClient.invalidateQueries({ queryKey: ['pay-approvals'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      form.reset({
        employeeId: defaultEmployeeId ?? '',
        month: initialMonth,
        year: initialYear,
        amount: 0,
        typeId: '',
        reason: '',
      })
      if (localEdit) {
        setLocalEdit(null)
        return
      }
      onOpenChange(false)
      onSuccess?.()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: isEdit ? 'Failed to save' : 'Failed to add incentive',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={isEdit ? 'max-w-md' : 'max-h-[90vh] max-w-lg overflow-y-auto'}>
        <DialogHeader>
          <DialogTitle>
            {editRequest ? 'Edit incentive request' : activeEdit ? 'Edit Incentive' : 'Add Incentive'}
          </DialogTitle>
        </DialogHeader>
        {!isEdit ? (
          <AddIncentivesForm
            defaultEmployeeId={defaultEmployeeId}
            defaultMonth={initialMonth}
            defaultYear={initialYear}
            onCancel={() => onOpenChange(false)}
            onEdit={setLocalEdit}
            onDone={() => {
              onOpenChange(false)
              onSuccess?.()
            }}
          />
        ) : (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
          >
            {isEdit ? (
              <p className="text-sm font-medium">
                {activeEdit?.employee?.fullName ?? editRequest?.employee?.fullName}
              </p>
            ) : null}
            {!defaultEmployeeId && !isEdit && (
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
              name="typeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Incentive type *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {incentiveTypes
                        .filter((t) => t.isActive)
                        .map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
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
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note (optional, printed on the stipend slip next to the type)</FormLabel>
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

            {needsApproval ? (
              <>
                {activeEdit ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    The amount is higher than before ({originalAmount.toLocaleString('en-PK')}), so
                    it needs approval. The current amount stays until it is approved.
                  </p>
                ) : null}
                <ApproverSelect value={approver} onChange={setApprover} id="incentive-approver" />
              </>
            ) : activeEdit ? (
              <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-text-secondary">
                Saved straight away and the month&apos;s payroll is updated.
              </p>
            ) : (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Incentives are final once added and automatically reflected in the
                employee&apos;s payroll for the selected month.
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => (localEdit ? setLocalEdit(null) : onOpenChange(false))}
              >
                {localEdit ? 'Back' : 'Cancel'}
              </Button>
              <Button type="submit" disabled={mutation.isPending || (needsApproval && !approver)}>
                {mutation.isPending
                  ? 'Saving...'
                  : editRequest
                    ? 'Save request'
                    : needsApproval
                      ? 'Send for approval'
                      : activeEdit
                        ? 'Save'
                        : 'Add Incentive'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
