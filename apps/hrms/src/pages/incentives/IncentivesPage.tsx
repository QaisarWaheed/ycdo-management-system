import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Plus, Trash2 } from 'lucide-react'
import { branchesApi } from '@/api/endpoints/branches'
import { incentivesApi } from '@/api/endpoints/incentives'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
import { MonthYearPicker } from '@/components/common/MonthYearPicker'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
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
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import type { Incentive } from '@/types'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import { AddIncentiveDialog } from './AddIncentiveDialog'

const ALL = 'ALL'

function formatPKR(amount: number | string) {
  return `PKR ${Number(amount).toLocaleString('en-PK')}`
}

function truncateReason(reason: string, max = 80) {
  if (reason.length <= max) return reason
  return `${reason.slice(0, max)}…`
}

export function IncentivesPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const now = new Date()

  const [employeeId, setEmployeeId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [monthYear, setMonthYear] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })
  const [addOpen, setAddOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const canDelete =
    user?.role === 'SUPER_ADMIN' || user?.role === 'HR_ADMIN_MANAGER'

  const filters = useMemo(
    () => ({
      employeeId: employeeId || undefined,
      branchId: branchId || undefined,
      month: monthYear.month,
      year: monthYear.year,
    }),
    [employeeId, branchId, monthYear],
  )

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: incentives = [], isLoading } = useQuery({
    queryKey: ['incentives', filters],
    queryFn: () => incentivesApi.getAll(filters),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => incentivesApi.delete(id),
    onSuccess: () => {
      toast({ title: 'Incentive deleted' })
      queryClient.invalidateQueries({ queryKey: ['incentives'] })
      setDeleteId(null)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to delete',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const list = incentives as Incentive[]
  const totalAmount = list.reduce((sum, i) => sum + Number(i.amount), 0)
  const uniqueEmployees = new Set(list.map((i) => i.employeeId)).size

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-text-primary">Incentives</h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Incentive
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { label: 'Total Incentives This Month', value: list.length },
          {
            label: 'Total Amount This Month',
            value: formatPKR(totalAmount),
          },
          {
            label: 'Total Employees with Incentives',
            value: uniqueEmployees,
          },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="p-6">
              <p className="text-2xl font-bold">{card.value}</p>
              <p className="text-sm text-text-secondary">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <EmployeeSearchSelect
            label="Employee"
            value={employeeId}
            onChange={(id) => setEmployeeId(id)}
            placeholder="Filter by employee..."
          />
        </div>
        <div className="space-y-1">
          <Label>Branch</Label>
          <Select
            value={branchId || ALL}
            onValueChange={(v) => setBranchId(v === ALL ? '' : v)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {formatBranchLabel(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <MonthYearPicker value={monthYear} onChange={setMonthYear} />
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Month/Year</TableHead>
              <TableHead>Added By</TableHead>
              <TableHead>Added On</TableHead>
              {canDelete && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(canDelete ? 8 : 7)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : list.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canDelete ? 8 : 7}
                  className="h-32 text-center text-text-secondary"
                >
                  No incentives found
                </TableCell>
              </TableRow>
            ) : (
              list.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {item.employee
                      ? `${item.employee.firstName} ${item.employee.lastName}`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {formatBranchLabel(item.employee?.currentBranch)}
                  </TableCell>
                  <TableCell className="font-medium text-green-600">
                    {formatPKR(item.amount)}
                  </TableCell>
                  <TableCell
                    className="max-w-[200px] truncate"
                    title={item.reason}
                  >
                    {truncateReason(item.reason)}
                  </TableCell>
                  <TableCell>
                    {item.month}/{item.year}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {item.addedBy.slice(0, 8)}…
                  </TableCell>
                  <TableCell>
                    {format(new Date(item.createdAt), 'dd/MM/yyyy')}
                  </TableCell>
                  {canDelete && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteId(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AddIncentiveDialog open={addOpen} onOpenChange={setAddOpen} />

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Incentive"
        description="Are you sure you want to delete this incentive? This will reverse the payroll allowance."
        confirmLabel="Delete"
        confirmVariant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  )
}
