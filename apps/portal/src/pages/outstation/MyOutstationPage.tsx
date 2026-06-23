import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { differenceInCalendarDays, format } from 'date-fns'
import { Plus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { outstationApi } from '@/api/endpoints/outstation'
import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import type { OutstationRequest } from '@/types'

function OutstationStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
    APPROVED: 'bg-green-100 text-green-800 border-green-200',
    REJECTED: 'bg-red-100 text-red-800 border-red-200',
    COMPLETED: 'bg-blue-100 text-blue-800 border-blue-200',
  }
  return (
    <Badge variant="outline" className={styles[status] ?? ''}>
      {status}
    </Badge>
  )
}

const requestSchema = z
  .object({
    district: z.string().min(1, 'District is required'),
    purpose: z
      .string()
      .min(1, 'Purpose is required')
      .max(1000, 'Purpose must be 1000 characters or less'),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
    notes: z.string().max(500, 'Notes must be 500 characters or less').optional(),
  })
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true
      return new Date(data.endDate) >= new Date(data.startDate)
    },
    { message: 'End date must be on or after start date', path: ['endDate'] },
  )

type RequestFormValues = z.infer<typeof requestSchema>

function NewRequestDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const employeeId = user?.employeeId ?? ''

  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      district: '',
      purpose: '',
      startDate: '',
      endDate: '',
      notes: '',
    },
  })

  const startDate = form.watch('startDate')
  const endDate = form.watch('endDate')

  const durationPreview = useMemo(() => {
    if (!startDate || !endDate) return null
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (end < start) return null
    return differenceInCalendarDays(end, start) + 1
  }, [startDate, endDate])

  const mutation = useMutation({
    mutationFn: (values: RequestFormValues) =>
      outstationApi.create({
        employeeId,
        district: values.district,
        purpose: values.purpose,
        startDate: values.startDate,
        endDate: values.endDate,
        notes: values.notes || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Outstation request submitted' })
      queryClient.invalidateQueries({ queryKey: ['outstation'] })
      form.reset()
      onOpenChange(false)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Outstation Request</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="district"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>District</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Gilgit, Skardu" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="purpose"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Purpose</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe the purpose of your outstation visit..."
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {durationPreview !== null && (
              <p className="text-sm text-text-secondary">
                Duration: {durationPreview} day
                {durationPreview !== 1 ? 's' : ''}
              </p>
            )}

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Any additional notes..."
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                {mutation.isPending ? 'Submitting...' : 'Submit Request'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export function MyOutstationPage() {
  const { user } = useAuth()
  const employeeId = user?.employeeId ?? ''
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['outstation', employeeId],
    queryFn: () => outstationApi.getAll({ employeeId }),
    enabled: !!employeeId,
  })

  const sorted = useMemo(
    () =>
      [...(requests as OutstationRequest[])].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [requests],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            My Outstation Requests
          </h1>
          <p className="text-sm text-text-secondary">
            View and submit outstation travel requests
          </p>
        </div>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Request
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>District</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>End</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Applied On</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(7)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-text-secondary"
                >
                  No outstation requests yet
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((req) => (
                <TableRow key={req.id}>
                  <TableCell className="font-medium">{req.district}</TableCell>
                  <TableCell className="max-w-[180px] truncate">
                    {req.purpose}
                  </TableCell>
                  <TableCell>
                    {format(new Date(req.startDate), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>
                    {format(new Date(req.endDate), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>
                    {req.duration} day{req.duration !== 1 ? 's' : ''}
                  </TableCell>
                  <TableCell>
                    <OutstationStatusBadge status={req.status} />
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

      <NewRequestDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
