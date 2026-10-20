import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  LOAN_PURPOSES,
  loansApi,
  type EmployeeLoan,
  type LoanKind,
  type LoanPurpose,
  type LoanStatus,
} from '@/api/endpoints/loans'
import { printLoanApplication } from '@/components/payroll/printLoanApplication'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

/** Finance and HR make applications and record the Founder's decision (mirrors the API). */
const LOAN_ROLES = [
  'SUPER_ADMIN',
  'PAYROLL_OFFICER',
  'HR_MANAGER',
  'HR_ADMIN_MANAGER',
  'HR_OPERATIONS_MANAGER',
  'HR_EXECUTIVE',
]

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase()
const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`
const STATUS_STYLE: Record<LoanStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-700',
}

type ApiError = { response?: { data?: { message?: string | string[] } } }
const errorText = (err: ApiError) => {
  const msg = err.response?.data?.message
  return Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error')
}

function nextMonth() {
  const d = new Date()
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

export function EmployeeLoansPanel(props: {
  employeeId: string
  employeeName?: string
  employeeCode?: string
  designation?: string | null
  branch?: string | null
  joiningDate: string
}) {
  const { employeeId } = props
  const queryClient = useQueryClient()
  const canManage = useAuth().hasRole(LOAN_ROLES)
  const { data } = useQuery({
    queryKey: ['loans', employeeId],
    queryFn: () => loansApi.forEmployee(employeeId),
  })
  const [applyOpen, setApplyOpen] = useState(false)
  const [decide, setDecide] = useState<{ loan: EmployeeLoan; action: 'approve' | 'reject' | 'cancel' }>()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['loans', employeeId] })
  const eligibility = data?.eligibility

  const print = (loan: EmployeeLoan) =>
    printLoanApplication({ ...props, loan, serviceMonths: eligibility?.serviceMonths ?? 0 })

  const viewNotification = async (loan: EmployeeLoan) => {
    const blob = await loansApi.notification(loan.id)
    window.open(URL.createObjectURL(blob), '_blank')
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-lg">Loans &amp; Advances</CardTitle>
          {eligibility ? (
            <p className="text-xs text-text-secondary">
              Service: {eligibility.serviceMonths} months · loans need at least {eligibility.minMonths} months
            </p>
          ) : null}
        </div>
        {canManage ? (
          <div className="text-right">
            <Button size="sm" onClick={() => setApplyOpen(true)}>
              New loan / advance application
            </Button>
            {eligibility && !eligibility.eligible ? (
              <p className="mt-1 text-xs font-medium text-red-600">Not eligible for loan (advance allowed)</p>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Applied</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Installment</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Repaid</TableHead>
              <TableHead>Remaining</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data?.loans.length ? (
              <TableRow>
                <TableCell colSpan={9} className="text-text-secondary">
                  No loans or advances
                </TableCell>
              </TableRow>
            ) : (
              data.loans.map((loan) => (
                <TableRow key={loan.id}>
                  <TableCell>{format(new Date(loan.createdAt), 'dd/MM/yyyy')}</TableCell>
                  <TableCell title={loan.reason}>
                    {loan.kind === 'ADVANCE' ? 'Advance' : 'Loan'}
                    <div className="text-xs text-text-secondary">{titleCase(loan.purpose)}</div>
                  </TableCell>
                  <TableCell>{pkr(loan.amount)}</TableCell>
                  <TableCell>{pkr(loan.monthlyInstallment)}</TableCell>
                  <TableCell>{format(new Date(loan.startMonth), 'MMM yyyy')}</TableCell>
                  <TableCell>{pkr(loan.repaid)}</TableCell>
                  <TableCell>{loan.status === 'APPROVED' ? pkr(loan.remaining) : '—'}</TableCell>
                  <TableCell>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[loan.status]}`}>
                      {loan.status === 'APPROVED' && loan.remaining <= 0 ? 'REPAID' : loan.status}
                    </span>
                  </TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap text-right">
                    <Button size="sm" variant="outline" onClick={() => print(loan)}>
                      Print
                    </Button>
                    {loan.notificationUrl ? (
                      <Button size="sm" variant="outline" onClick={() => viewNotification(loan)}>
                        Notification
                      </Button>
                    ) : null}
                    {canManage && loan.status === 'PENDING' ? (
                      <>
                        <Button size="sm" onClick={() => setDecide({ loan, action: 'approve' })}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setDecide({ loan, action: 'reject' })}>
                          Reject
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDecide({ loan, action: 'cancel' })}>
                          Cancel
                        </Button>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
      <ApplyLoanDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        employeeId={employeeId}
        loanEligible={eligibility?.eligible ?? false}
        onCreated={refresh}
      />
      {decide ? (
        <DecideLoanDialog {...decide} onClose={() => setDecide(undefined)} onDone={refresh} />
      ) : null}
    </Card>
  )
}

function ApplyLoanDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeId: string
  loanEligible: boolean
  onCreated: () => void
}) {
  const [kind, setKind] = useState<LoanKind>('LOAN')
  const [purpose, setPurpose] = useState<LoanPurpose>('PERSONAL')
  const [amount, setAmount] = useState('')
  const [installment, setInstallment] = useState('')
  const [startMonth, setStartMonth] = useState(nextMonth())
  const [reason, setReason] = useState('')
  const a = Number(amount)
  const i = Number(installment)
  const mutation = useMutation({
    mutationFn: () =>
      loansApi.create({
        employeeId: props.employeeId,
        amount: a,
        monthlyInstallment: i,
        startMonth,
        reason: reason.trim(),
        kind,
        purpose,
      }),
    onSuccess: () => {
      toast({ title: 'Loan application created. Press Print on it for the CEO / Founder.' })
      props.onOpenChange(false)
      setAmount('')
      setInstallment('')
      setReason('')
      props.onCreated()
    },
    onError: (err: ApiError) =>
      toast({ title: 'Could not create the application', description: errorText(err), variant: 'destructive' }),
  })
  const blocked = kind === 'LOAN' && !props.loanEligible
  const valid = !blocked && a > 0 && i > 0 && i <= a && reason.trim().length >= 3 && !!startMonth
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New loan / advance application</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="loan-kind">Type</Label>
              <select
                id="loan-kind"
                className="h-10 w-full rounded-md border border-border bg-white px-3"
                value={kind}
                onChange={(e) => setKind(e.target.value as LoanKind)}
              >
                <option value="LOAN">Loan</option>
                <option value="ADVANCE">Salary advance</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="loan-purpose">Purpose</Label>
              <select
                id="loan-purpose"
                className="h-10 w-full rounded-md border border-border bg-white px-3"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as LoanPurpose)}
              >
                {LOAN_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {titleCase(p)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {blocked ? (
            <p className="text-sm font-medium text-red-600">
              Not eligible for loan: less than 6 months of service. A salary advance can still be applied for.
            </p>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="loan-amount">Amount (PKR)</Label>
            <Input id="loan-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="loan-installment">Monthly installment (PKR)</Label>
            <Input
              id="loan-installment"
              type="number"
              min={1}
              value={installment}
              onChange={(e) => setInstallment(e.target.value)}
            />
            {a > 0 && i > 0 ? (
              <p className="text-xs text-text-secondary">
                {i > a ? 'Installment cannot be more than the amount.' : `${Math.ceil(a / i)} monthly installments`}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="loan-start">Deduct from month</Label>
            <Input id="loan-start" type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="loan-reason">Details</Label>
            <Textarea id="loan-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Saving...' : 'Create application'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DecideLoanDialog(props: {
  loan: EmployeeLoan
  action: 'approve' | 'reject' | 'cancel'
  onClose: () => void
  onDone: () => void
}) {
  const [file, setFile] = useState<File>()
  const [note, setNote] = useState('')
  const { loan, action } = props
  const mutation = useMutation({
    mutationFn: () =>
      action === 'approve'
        ? loansApi.approve(loan.id, file!, note.trim() || undefined)
        : action === 'reject'
          ? loansApi.reject(loan.id, note.trim() || undefined)
          : loansApi.cancel(loan.id, note.trim() || undefined),
    onSuccess: () => {
      toast({
        title:
          action === 'approve'
            ? `Loan approved. Installments start ${format(new Date(loan.startMonth), 'MMMM yyyy')}.`
            : action === 'reject'
              ? 'Loan rejected'
              : 'Loan application cancelled',
      })
      props.onDone()
      props.onClose()
    },
    onError: (err: ApiError) =>
      toast({ title: 'Could not save', description: errorText(err), variant: 'destructive' }),
  })
  const title = { approve: 'Approve loan', reject: 'Reject loan', cancel: 'Cancel loan application' }[action]
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            {pkr(loan.amount)} · {pkr(loan.monthlyInstallment)} per month from{' '}
            {format(new Date(loan.startMonth), 'MMMM yyyy')}
          </p>
          {action === 'approve' ? (
            <div className="space-y-1">
              <Label htmlFor="loan-notification">Signed approval notification (photo or PDF)</Label>
              <Input
                id="loan-notification"
                type="file"
                accept=".jpg,.jpeg,.png,.pdf"
                onChange={(e) => setFile(e.target.files?.[0])}
              />
              <p className="text-xs text-text-secondary">
                Approve only after the Founder has signed. Installments then come off the salary automatically.
              </p>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="loan-note">Note (optional)</Label>
            <Input id="loan-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Close
          </Button>
          <Button
            variant={action === 'approve' ? 'default' : 'destructive'}
            disabled={mutation.isPending || (action === 'approve' && !file)}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving...' : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
