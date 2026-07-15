import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns'
import { ArrowLeftRight, Plus } from 'lucide-react'
import { branchesApi } from '@/api/endpoints/branches'
import { mutualSwapApi, type MutualSwapEmployee, type MutualSwapRecord } from '@/api/endpoints/mutualSwap'
import { DateInput } from '@/components/common/DateInput'
import { EmployeeSearchSelect } from '@/components/common/EmployeeSearchSelect'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { formatShiftOptionLabel } from '@/lib/shiftFilterUtils'
import { todayPakistan } from '@/lib/timeFormat'
import type { Employee } from '@/types'

function formatEmployeeShift(emp: MutualSwapEmployee): string {
  const start = emp.dutyStartTime ?? emp.shift?.startTime
  const end = emp.dutyEndTime ?? emp.shift?.endTime
  if (!start || !end) return '—'
  return formatShiftOptionLabel({
    name: emp.shift?.name ?? '',
    startTime: start,
    endTime: end,
  })
}

function swapStatusBadge(status: string) {
  if (status === 'ACTIVE') {
    return (
      <Badge className="border-green-200 bg-green-100 text-green-800">ACTIVE</Badge>
    )
  }
  return (
    <Badge className="border-red-200 bg-red-100 text-red-800">CANCELLED</Badge>
  )
}

function CreateSwapDialog({
  open,
  onOpenChange,
  defaultDate,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
  onSuccess: () => void
}) {
  const [date, setDate] = useState(defaultDate)
  const [coveredEmployeeId, setCoveredEmployeeId] = useState('')
  const [coveredEmployee, setCoveredEmployee] = useState<Employee | undefined>()
  const [coveringEmployeeId, setCoveringEmployeeId] = useState('')
  const [note, setNote] = useState('')

  const { data: eligible = [], isLoading: loadingEligible } = useQuery({
    queryKey: ['mutual-swap-eligible', coveredEmployeeId, date],
    queryFn: () => mutualSwapApi.getEligibleCovering(coveredEmployeeId, date),
    enabled: open && !!coveredEmployeeId,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      mutualSwapApi.create({
        coveringEmployeeId,
        coveredEmployeeId,
        date,
        note: note.trim() || undefined,
      }),
    onSuccess: (data) => {
      toast({ title: data.message })
      onSuccess()
      onOpenChange(false)
      setCoveredEmployeeId('')
      setCoveredEmployee(undefined)
      setCoveringEmployeeId('')
      setNote('')
    },
    onError: (err: Error) => {
      toast({
        title: 'Failed to create swap',
        description: err.message,
        variant: 'destructive',
      })
    },
  })

  const canSubmit =
    !!coveringEmployeeId && !!coveredEmployeeId && !!date && !createMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Mutual Swap (Double Duty)</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Date</Label>
            <DateInput value={date} onChange={setDate} />
          </div>

          <EmployeeSearchSelect
            label="Employee Being Covered"
            value={coveredEmployeeId}
            onChange={(id, emp) => {
              setCoveredEmployeeId(id)
              setCoveredEmployee(emp)
              setCoveringEmployeeId('')
            }}
          />
          {coveredEmployee && (
            <p className="text-sm text-text-secondary">
              Shift:{' '}
              {formatEmployeeShift({
                id: coveredEmployee.id,
                fullName: coveredEmployee.fullName,
                employeeCode: coveredEmployee.employeeCode,
                dutyStartTime: coveredEmployee.dutyStartTime,
                dutyEndTime: coveredEmployee.dutyEndTime,
                currentDesignation: coveredEmployee.currentDesignation,
                shift: coveredEmployee.shift,
              })}
              {coveredEmployee.currentDesignation
                ? ` · ${coveredEmployee.currentDesignation}`
                : ''}
            </p>
          )}

          <div className="space-y-1">
            <Label>Employee Covering</Label>
            {!coveredEmployeeId ? (
              <p className="text-sm text-text-secondary">
                Select the employee being covered first
              </p>
            ) : loadingEligible ? (
              <Skeleton className="h-10 w-full" />
            ) : eligible.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-amber-700">
                No employees with consecutive shift found
              </p>
            ) : (
              <Select value={coveringEmployeeId} onValueChange={setCoveringEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select covering employee" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.fullName} ({emp.employeeCode}) —{' '}
                      {formatEmployeeShift(emp)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1">
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
            Create Swap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CancelSwapDialog({
  swap,
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: {
  swap: MutualSwapRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isPending: boolean
}) {
  if (!swap) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel mutual swap?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-text-secondary">
          This will cancel the swap between {swap.coveringEmployee.fullName} and{' '}
          {swap.coveredEmployee.fullName} on{' '}
          {format(new Date(swap.date), 'dd/MM/yyyy')} and reverse attendance
          changes.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep swap
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            Cancel swap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MutualSwapTab() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const today = todayPakistan()
  const [dateFilter, setDateFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<MutualSwapRecord | null>(null)

  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const canCreate = ['SUPER_ADMIN', 'HR_MANAGER', 'HR_ADMIN_MANAGER'].includes(
    user?.role ?? '',
  )
  const canCancel = ['SUPER_ADMIN', 'HR_MANAGER'].includes(user?.role ?? '')

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
    enabled: isSuperAdmin,
  })

  const filters = useMemo(
    () => ({
      ...(branchFilter && { branchId: branchFilter }),
      ...(dateFilter && { date: dateFilter }),
      ...(employeeFilter && { employeeId: employeeFilter }),
    }),
    [branchFilter, dateFilter, employeeFilter],
  )

  const { data: swaps = [], isLoading } = useQuery({
    queryKey: ['mutual-swaps', filters],
    queryFn: () => mutualSwapApi.getAll(filters),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => mutualSwapApi.cancel(id),
    onSuccess: (data) => {
      toast({ title: data.message })
      queryClient.invalidateQueries({ queryKey: ['mutual-swaps'] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      setCancelTarget(null)
    },
    onError: (err: Error) => {
      toast({
        title: 'Failed to cancel swap',
        description: err.message,
        variant: 'destructive',
      })
    },
  })

  const monthStart = startOfMonth(new Date())
  const monthEnd = endOfMonth(new Date())

  const summary = useMemo(() => {
    const todaySwaps = swaps.filter(
      (s) => format(new Date(s.date), 'yyyy-MM-dd') === today,
    ).length
    const monthSwaps = swaps.filter((s) =>
      isWithinInterval(parseISO(s.date.split('T')[0]!), {
        start: monthStart,
        end: monthEnd,
      }),
    ).length
    const activeSwaps = swaps.filter((s) => s.status === 'ACTIVE').length
    return { todaySwaps, monthSwaps, activeSwaps }
  }, [swaps, today, monthStart, monthEnd])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['mutual-swaps'] })
    queryClient.invalidateQueries({ queryKey: ['attendance'] })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-text-secondary">
          <ArrowLeftRight className="h-5 w-5" />
          <p className="text-sm">
            Double duty swaps for consecutive shifts — covering employee gets
            overtime automatically.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Swap
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-text-secondary">Today&apos;s Swaps</p>
            <p className="text-2xl font-bold">{summary.todaySwaps}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-text-secondary">This Month</p>
            <p className="text-2xl font-bold">{summary.monthSwaps}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-text-secondary">Active</p>
            <p className="text-2xl font-bold">{summary.activeSwaps}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>Date</Label>
          <DateInput value={dateFilter} onChange={setDateFilter} />
        </div>
        {isSuperAdmin && (
          <div className="space-y-1">
            <Label>Branch</Label>
            <Select
              value={branchFilter || '__all__'}
              onValueChange={(v) => setBranchFilter(v === '__all__' ? '' : v)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="min-w-[240px] flex-1">
          <EmployeeSearchSelect
            label="Employee"
            value={employeeFilter}
            onChange={(id) => setEmployeeFilter(id)}
          />
        </div>
        {(dateFilter || branchFilter || employeeFilter) && (
          <Button
            variant="ghost"
            onClick={() => {
              setDateFilter('')
              setBranchFilter('')
              setEmployeeFilter('')
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Covering Employee</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead>Covered Employee</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            ) : swaps.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-text-secondary">
                  No mutual swaps found
                </TableCell>
              </TableRow>
            ) : (
              swaps.map((swap) => (
                <TableRow key={swap.id}>
                  <TableCell>{format(new Date(swap.date), 'dd/MM/yyyy')}</TableCell>
                  <TableCell>
                    <div className="font-medium">{swap.coveringEmployee.fullName}</div>
                    <div className="text-xs text-text-secondary">
                      {swap.coveringEmployee.employeeCode}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {formatEmployeeShift(swap.coveringEmployee)}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{swap.coveredEmployee.fullName}</div>
                    <div className="text-xs text-text-secondary">
                      {swap.coveredEmployee.employeeCode}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-text-secondary">
                    {formatEmployeeShift(swap.coveredEmployee)}
                  </TableCell>
                  <TableCell>{swapStatusBadge(swap.status)}</TableCell>
                  <TableCell className="text-right">
                    {canCancel && swap.status === 'ACTIVE' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600"
                        onClick={() => setCancelTarget(swap)}
                      >
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CreateSwapDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultDate={today}
        onSuccess={refresh}
      />

      <CancelSwapDialog
        swap={cancelTarget}
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        onConfirm={() => cancelTarget && cancelMutation.mutate(cancelTarget.id)}
        isPending={cancelMutation.isPending}
      />
    </div>
  )
}
