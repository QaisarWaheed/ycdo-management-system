import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  advanceLoanApi,
  type CreateAdvanceLoanPayload,
} from '@/api/endpoints/advanceLoan'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { formatPKR } from '@/lib/helpers'
import type { AdvanceLoanRequest } from '@/types'

const REPAYMENT_OPTIONS = [3, 6, 12, 24] as const

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
    APPROVED: 'bg-green-100 text-green-800 border-green-200',
    REJECTED: 'bg-red-100 text-red-800 border-red-200',
  }
  return (
    <Badge variant="outline" className={styles[status] ?? ''}>
      {status}
    </Badge>
  )
}

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
      {type}
    </Badge>
  )
}

const requestSchema = z
  .object({
    type: z.enum(['ADVANCE', 'LOAN'], { message: 'Request type is required' }),
    amount: z
      .number({ message: 'Amount is required' })
      .positive('Amount must be greater than 0'),
    reason: z
      .string()
      .min(20, 'Reason must be at least 20 characters'),
    repaymentMonths: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'LOAN' && !data.repaymentMonths) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Repayment period is required for loans',
        path: ['repaymentMonths'],
      })
    }
  })

type RequestFormValues = z.infer<typeof requestSchema>

function MyRequestsTab() {
  const { user } = useAuth()

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['advance-loan', 'my'],
    queryFn: () => advanceLoanApi.getMy(),
    enabled: !!user?.employeeId,
  })

  const sorted = useMemo(
    () =>
      [...(requests as AdvanceLoanRequest[])].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [requests],
  )

  return (
    <div className="rounded-lg border border-border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Requested On</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            [...Array(4)].map((_, i) => (
              <TableRow key={i}>
                {[...Array(5)].map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : sorted.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="py-8 text-center text-text-secondary"
              >
                No advance or loan requests yet
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((req) => (
              <TableRow key={req.id}>
                <TableCell>
                  <TypeBadge type={req.type} />
                </TableCell>
                <TableCell className="font-medium">
                  {formatPKR(req.amount)}
                </TableCell>
                <TableCell className="max-w-xs truncate" title={req.reason}>
                  {req.reason}
                </TableCell>
                <TableCell>
                  <StatusBadge status={req.status} />
                </TableCell>
                <TableCell>
                  {format(new Date(req.createdAt), 'dd/MM/yyyy')}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function NewRequestTab({ onSuccess }: { onSuccess: () => void }) {
  const queryClient = useQueryClient()

  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      type: 'ADVANCE',
      amount: undefined,
      reason: '',
      repaymentMonths: undefined,
    },
  })

  const requestType = form.watch('type')
  const amount = form.watch('amount')
  const repaymentMonths = form.watch('repaymentMonths')

  const monthlyDeductionPreview = useMemo(() => {
    if (requestType !== 'LOAN' || !amount || !repaymentMonths) return null
    if (amount <= 0 || repaymentMonths <= 0) return null
    return amount / repaymentMonths
  }, [requestType, amount, repaymentMonths])

  const mutation = useMutation({
    mutationFn: (values: RequestFormValues) => {
      const payload: CreateAdvanceLoanPayload = {
        type: values.type,
        amount: values.amount,
        reason: values.reason,
      }
      if (values.type === 'LOAN' && values.repaymentMonths) {
        payload.repaymentMonths = values.repaymentMonths
      }
      return advanceLoanApi.create(payload)
    },
    onSuccess: () => {
      toast({ title: 'Request submitted successfully' })
      queryClient.invalidateQueries({ queryKey: ['advance-loan'] })
      form.reset({
        type: 'ADVANCE',
        amount: undefined,
        reason: '',
        repaymentMonths: undefined,
      })
      onSuccess()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to submit request',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Card className="border-border shadow-sm">
      <CardContent className="p-6">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="mx-auto max-w-lg space-y-4"
          >
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Request Type</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v)
                      if (v === 'ADVANCE') {
                        form.setValue('repaymentMonths', undefined)
                      }
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="ADVANCE">Advance</SelectItem>
                      <SelectItem value="LOAN">Loan</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (PKR)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      step="0.01"
                      placeholder="Enter amount in PKR"
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === '' ? undefined : Number(e.target.value),
                        )
                      }
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
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
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe why you need this advance or loan (minimum 20 characters)..."
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {requestType === 'LOAN' && (
              <>
                <FormField
                  control={form.control}
                  name="repaymentMonths"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Repayment Period</FormLabel>
                      <Select
                        value={field.value ? String(field.value) : ''}
                        onValueChange={(v) => field.onChange(Number(v))}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select repayment period" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {REPAYMENT_OPTIONS.map((months) => (
                            <SelectItem key={months} value={String(months)}>
                              {months} months
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {monthlyDeductionPreview != null && (
                  <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
                    <p className="text-text-secondary">Estimated monthly deduction</p>
                    <p className="text-lg font-semibold text-text-primary">
                      {formatPKR(monthlyDeductionPreview)}
                    </p>
                  </div>
                )}
              </>
            )}

            <Button type="submit" disabled={mutation.isPending} className="w-full">
              {mutation.isPending ? 'Submitting...' : 'Submit Request'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

export function AdvanceLoanPage() {
  const [tab, setTab] = useState('requests')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          Advance & Loan Requests
        </h1>
        <p className="text-sm text-text-secondary">
          Request a salary advance or loan and track your submissions
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requests">My Requests</TabsTrigger>
          <TabsTrigger value="new">New Request</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-4">
          <MyRequestsTab />
        </TabsContent>

        <TabsContent value="new" className="mt-4">
          <NewRequestTab onSuccess={() => setTab('requests')} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
