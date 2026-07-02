import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { Printer } from 'lucide-react'
import { incentivesApi } from '@/api/endpoints/incentives'
import { employeesApi } from '@/api/endpoints/employees'
import { payrollApi } from '@/api/endpoints/payroll'
import { stipendReceiptsApi } from '@/api/endpoints/stipendReceipts'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
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
import { formatPKR } from '@/lib/helpers'
import type { Incentive, PayrollEntry, StipendReceipt, StipendStatus } from '@/types'

function PayrollStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
    PROCESSED: 'bg-blue-100 text-blue-800 border-blue-200',
    PAID: 'bg-green-100 text-green-800 border-green-200',
  }
  return (
    <Badge variant="outline" className={styles[status] ?? ''}>
      {status}
    </Badge>
  )
}

function StipendReceiptStatusBadge({ status }: { status: StipendStatus }) {
  const config: Record<StipendStatus, { label: string; className: string }> = {
    PENDING: {
      label: 'Awaiting Response',
      className: 'bg-amber-100 text-amber-800 border-amber-200',
    },
    ACCEPTED: {
      label: 'Accepted',
      className: 'bg-green-100 text-green-800 border-green-200',
    },
    REJECTED: {
      label: 'Rejected',
      className: 'bg-red-100 text-red-800 border-red-200',
    },
    AUTO_ACCEPTED: {
      label: 'Auto-Accepted',
      className: 'bg-blue-100 text-blue-800 border-blue-200',
    },
  }
  const item = config[status]
  return (
    <Badge variant="outline" className={item.className}>
      {item.label}
    </Badge>
  )
}

function PayslipDialog({
  entry,
  open,
  onOpenChange,
  employeeName,
}: {
  entry: PayrollEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeName: string
}) {
  const { data: fullEntry, isLoading } = useQuery({
    queryKey: ['payroll-entry-full', entry?.id],
    queryFn: () => payrollApi.getEntryFull(entry!.id),
    enabled: !!entry && open,
  })

  if (!entry) return null

  const data = fullEntry ?? entry
  const deductions = data.deductions ?? []
  const allowances = data.allowances ?? []
  const totalDeductions = deductions.reduce(
    (sum, d) => sum + Number(d.amount),
    0,
  )
  const totalAllowances = allowances.reduce(
    (sum, a) => sum + Number(a.amount),
    0,
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="no-print">
          <DialogTitle>Payslip</DialogTitle>
        </DialogHeader>

        <div className="no-print mb-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="print-content space-y-4">
            <div className="hidden text-center print:block print:mb-6">
              <h2 className="text-xl font-bold text-primary">YCDO</h2>
              <p className="text-sm">Youth Community Development Organization</p>
              <p className="mt-2 font-semibold">Stipend Payslip</p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-text-secondary">Employee</p>
                  <p className="font-medium">{employeeName}</p>
                </div>
                <div>
                  <p className="text-text-secondary">Period</p>
                  <p className="font-medium">
                    {format(new Date(data.year, data.month - 1, 1), 'MMMM yyyy')}
                  </p>
                </div>
                <div>
                  <p className="text-text-secondary">Basic Stipend</p>
                  <p className="font-medium">{formatPKR(data.basicStipend)}</p>
                </div>
                <div>
                  <p className="text-text-secondary">Status</p>
                  <PayrollStatusBadge status={data.status} />
                </div>
              </div>
            </div>

            <div>
              <h4 className="mb-2 font-semibold">Deductions</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deductions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-text-secondary">
                        No deductions
                      </TableCell>
                    </TableRow>
                  ) : (
                    deductions.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>{d.reason.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-right text-red-600">
                          {formatPKR(d.amount)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <p className="mt-1 text-right text-sm font-semibold">
                Total: {formatPKR(totalDeductions)}
              </p>
            </div>

            <div>
              <h4 className="mb-2 font-semibold">Allowances</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allowances.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-text-secondary">
                        No allowances
                      </TableCell>
                    </TableRow>
                  ) : (
                    allowances.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{a.type.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-right text-green-600">
                          {formatPKR(a.amount)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <p className="mt-1 text-right text-sm font-semibold">
                Total: {formatPKR(totalAllowances)}
              </p>
            </div>

            <div className="rounded-lg border-2 border-primary bg-primary/5 p-4 text-center">
              <p className="text-sm text-text-secondary">Net Stipend</p>
              <p className="text-3xl font-bold text-primary">
                {formatPKR(data.netStipend)}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StipendReceiptSection() {
  const queryClient = useQueryClient()
  const [acceptReceipt, setAcceptReceipt] = useState<StipendReceipt | null>(null)
  const [rejectReceipt, setRejectReceipt] = useState<StipendReceipt | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [, setTick] = useState(0)

  const { data: pendingList = [], isLoading: loadingPending } = useQuery({
    queryKey: ['stipend-receipt-pending'],
    queryFn: () => stipendReceiptsApi.getPending(),
  })

  const { data: history = [], isLoading: loadingHistory } = useQuery({
    queryKey: ['stipend-receipt-my'],
    queryFn: () => stipendReceiptsApi.getMy(),
  })

  const pending = (pendingList as StipendReceipt[])[0] ?? null

  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(timer)
  }, [pending])

  const respondMutation = useMutation({
    mutationFn: (data: {
      receiptId: string
      accept: boolean
      rejectionReason?: string
    }) => stipendReceiptsApi.respond(data),
    onSuccess: () => {
      toast({ title: 'Stipend receipt updated' })
      queryClient.invalidateQueries({ queryKey: ['stipend-receipt-pending'] })
      queryClient.invalidateQueries({ queryKey: ['stipend-receipt-my'] })
      setAcceptReceipt(null)
      setRejectReceipt(null)
      setRejectionReason('')
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to respond',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <div className="space-y-4">
      {loadingPending ? (
        <Skeleton className="h-40 w-full" />
      ) : pending ? (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="space-y-4 p-6">
            <p className="font-medium text-amber-800">
              Your stipend receipt for {pending.month}/{pending.year} is ready
            </p>
            <div>
              <p className="text-sm text-text-secondary">Amount</p>
              <p className="text-4xl font-bold text-primary">
                {formatPKR(pending.amount)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-text-secondary">Generated</p>
                <p>{format(new Date(pending.generatedAt), 'dd MMM yyyy HH:mm')}</p>
              </div>
              <div>
                <p className="text-text-secondary">Deadline</p>
                <p>
                  {format(new Date(pending.deadlineAt), 'dd MMM yyyy HH:mm')}
                  <span className="ml-1 text-amber-700">
                    ({formatDistanceToNow(new Date(pending.deadlineAt), { addSuffix: true })})
                  </span>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={() => setAcceptReceipt(pending)}
              >
                Accept Stipend
              </Button>
              <Button
                variant="destructive"
                onClick={() => setRejectReceipt(pending)}
              >
                Reject Stipend
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border bg-surface">
          <CardContent className="p-6 text-center text-text-secondary">
            No pending stipend receipts
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold">Stipend Receipt History</h2>
        <div className="rounded-lg border border-border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month/Year</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Response Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingHistory ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(4)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (history as StipendReceipt[]).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-text-secondary">
                    No stipend receipt history
                  </TableCell>
                </TableRow>
              ) : (
                (history as StipendReceipt[]).map((receipt) => (
                  <TableRow key={receipt.id}>
                    <TableCell>
                      {receipt.month}/{receipt.year}
                    </TableCell>
                    <TableCell>{formatPKR(receipt.amount)}</TableCell>
                    <TableCell>
                      <StipendReceiptStatusBadge status={receipt.status} />
                    </TableCell>
                    <TableCell>
                      {receipt.acceptedAt
                        ? format(new Date(receipt.acceptedAt), 'dd/MM/yyyy')
                        : receipt.rejectedAt
                          ? format(new Date(receipt.rejectedAt), 'dd/MM/yyyy')
                          : receipt.autoAcceptedAt
                            ? format(new Date(receipt.autoAcceptedAt), 'dd/MM/yyyy')
                            : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ConfirmDialog
        open={!!acceptReceipt}
        title="Accept Stipend"
        description={
          acceptReceipt
            ? `Confirm acceptance of ${formatPKR(acceptReceipt.amount)} stipend for ${acceptReceipt.month}/${acceptReceipt.year}`
            : ''
        }
        confirmLabel="Accept"
        loading={respondMutation.isPending}
        onConfirm={() =>
          acceptReceipt &&
          respondMutation.mutate({
            receiptId: acceptReceipt.id,
            accept: true,
          })
        }
        onCancel={() => setAcceptReceipt(null)}
      />

      <Dialog open={!!rejectReceipt} onOpenChange={(v) => !v && setRejectReceipt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Stipend</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Rejection reason *</Label>
            <Textarea
              placeholder="I am rejecting this stipend because..."
              rows={4}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
            <p className="text-xs text-text-secondary">
              Minimum 10 characters required
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectReceipt(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                respondMutation.isPending || rejectionReason.trim().length < 10
              }
              onClick={() =>
                rejectReceipt &&
                respondMutation.mutate({
                  receiptId: rejectReceipt.id,
                  accept: false,
                  rejectionReason: rejectionReason.trim(),
                })
              }
            >
              Reject Stipend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function MyPayrollPage() {
  const { user } = useAuth()
  const employeeId = user?.employeeId ?? ''
  const [viewEntry, setViewEntry] = useState<PayrollEntry | null>(null)

  const { data: employee } = useQuery({
    queryKey: ['employee-payroll', employeeId],
    queryFn: () => employeesApi.getOne(employeeId),
    enabled: !!employeeId,
  })

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['payroll-history', employeeId],
    queryFn: () => payrollApi.getMyHistory(employeeId),
    enabled: !!employeeId,
  })

  const { data: incentives = [], isLoading: loadingIncentives } = useQuery({
    queryKey: ['incentives', employeeId],
    queryFn: () => incentivesApi.getByEmployee(employeeId),
    enabled: !!employeeId,
  })

  const currentStipend = employee?.stipendRecords?.[0]
  const employeeName = employee
    ? employee.fullName
    : 'Employee'

  const sortedHistory = [...(history as PayrollEntry[])].sort(
    (a, b) =>
      new Date(b.year, b.month - 1).getTime() -
      new Date(a.year, a.month - 1).getTime(),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">My Payroll</h1>
        <p className="text-sm text-text-secondary">
          View your stipend, receipts, incentives and download payslips
        </p>
      </div>

      <StipendReceiptSection />

      <Card className="border-border bg-gradient-to-r from-primary/5 to-accent/5 shadow-sm">
        <CardContent className="p-6">
          <p className="text-sm text-text-secondary">Current Basic Stipend</p>
          {employee ? (
            <>
              <p className="text-4xl font-bold text-primary">
                {currentStipend ? formatPKR(currentStipend.basicStipend) : '—'}
              </p>
              {currentStipend && (
                <p className="mt-1 text-xs text-text-secondary">
                  Effective from{' '}
                  {format(new Date(currentStipend.effectiveFrom), 'dd MMM yyyy')}
                </p>
              )}
            </>
          ) : (
            <Skeleton className="mt-2 h-10 w-40" />
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Incentives</h2>
        <div className="rounded-lg border border-border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month/Year</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Added On</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingIncentives ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(4)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (incentives as Incentive[]).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-text-secondary">
                    No incentives recorded yet
                  </TableCell>
                </TableRow>
              ) : (
                (incentives as Incentive[]).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {item.month}/{item.year}
                    </TableCell>
                    <TableCell className="font-medium text-green-600">
                      {formatPKR(item.amount)}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate" title={item.reason}>
                      {item.reason}
                    </TableCell>
                    <TableCell>
                      {format(new Date(item.createdAt), 'dd/MM/yyyy')}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Payroll History</h2>
        <div className="rounded-lg border border-border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Basic</TableHead>
                <TableHead>Deductions</TableHead>
                <TableHead>Allowances</TableHead>
                <TableHead>Net Stipend</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]" />
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
              ) : sortedHistory.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-text-secondary"
                  >
                    No payroll records found
                  </TableCell>
                </TableRow>
              ) : (
                sortedHistory.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">
                      {format(new Date(entry.year, entry.month - 1, 1), 'MMM yyyy')}
                    </TableCell>
                    <TableCell>{formatPKR(entry.basicStipend)}</TableCell>
                    <TableCell className="text-red-600">
                      {formatPKR(entry.totalDeductions)}
                    </TableCell>
                    <TableCell className="text-green-600">
                      {formatPKR(entry.totalAllowances)}
                    </TableCell>
                    <TableCell className="font-semibold">
                      {formatPKR(entry.netStipend)}
                    </TableCell>
                    <TableCell>
                      <PayrollStatusBadge status={entry.status} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewEntry(entry)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <PayslipDialog
        entry={viewEntry}
        open={!!viewEntry}
        onOpenChange={(v) => !v && setViewEntry(null)}
        employeeName={employeeName}
      />
    </div>
  )
}
