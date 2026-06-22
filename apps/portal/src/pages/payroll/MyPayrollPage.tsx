import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Printer } from 'lucide-react'
import { payrollApi } from '@/api/endpoints/payroll'
import { employeesApi } from '@/api/endpoints/employees'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/hooks/useAuth'
import { formatPKR } from '@/lib/helpers'
import type { PayrollEntry } from '@/types'

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
              <p className="mt-2 font-semibold">Salary Payslip</p>
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
                    {format(
                      new Date(data.year, data.month - 1, 1),
                      'MMMM yyyy',
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-text-secondary">Basic Salary</p>
                  <p className="font-medium">{formatPKR(data.basicSalary)}</p>
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
              <p className="text-sm text-text-secondary">Net Salary</p>
              <p className="text-3xl font-bold text-primary">
                {formatPKR(data.netSalary)}
              </p>
            </div>

            <p className="hidden text-center text-xs text-text-secondary print:block">
              Generated from YCDO Employee Portal · Confidential
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
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

  const currentSalary = employee?.salaryRecords?.[0]
  const employeeName = employee
    ? `${employee.firstName} ${employee.lastName}`
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
          View your salary and download payslips
        </p>
      </div>

      <Card className="border-border bg-gradient-to-r from-primary/5 to-accent/5 shadow-sm">
        <CardContent className="p-6">
          <p className="text-sm text-text-secondary">Current Basic Salary</p>
          {employee ? (
            <>
              <p className="text-4xl font-bold text-primary">
                {currentSalary
                  ? formatPKR(currentSalary.basicSalary)
                  : '—'}
              </p>
              {currentSalary && (
                <p className="mt-1 text-xs text-text-secondary">
                  Effective from{' '}
                  {format(new Date(currentSalary.effectiveFrom), 'dd MMM yyyy')}
                </p>
              )}
            </>
          ) : (
            <Skeleton className="mt-2 h-10 w-40" />
          )}
        </CardContent>
      </Card>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Basic</TableHead>
              <TableHead>Deductions</TableHead>
              <TableHead>Allowances</TableHead>
              <TableHead>Net Salary</TableHead>
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
                    {format(
                      new Date(entry.year, entry.month - 1, 1),
                      'MMM yyyy',
                    )}
                  </TableCell>
                  <TableCell>{formatPKR(entry.basicSalary)}</TableCell>
                  <TableCell className="text-red-600">
                    {formatPKR(entry.totalDeductions)}
                  </TableCell>
                  <TableCell className="text-green-600">
                    {formatPKR(entry.totalAllowances)}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {formatPKR(entry.netSalary)}
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

      <PayslipDialog
        entry={viewEntry}
        open={!!viewEntry}
        onOpenChange={(v) => !v && setViewEntry(null)}
        employeeName={employeeName}
      />
    </div>
  )
}
