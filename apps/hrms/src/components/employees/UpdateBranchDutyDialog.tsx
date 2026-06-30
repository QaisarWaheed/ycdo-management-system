import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { dutyTimeOptions, formatDutyDisplay } from '@/lib/dutyTimes'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import type { Employee } from '@/types'

export function UpdateBranchDutyDialog({
  employee,
  open,
  onOpenChange,
  onSuccess,
}: {
  employee: Employee
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const [branchId, setBranchId] = useState(employee.currentBranchId ?? '')
  const [departmentId, setDepartmentId] = useState(
    employee.currentDepartmentId ?? '',
  )
  const [dutyStartTime, setDutyStartTime] = useState(
    employee.dutyStartTime ?? '',
  )
  const [dutyEndTime, setDutyEndTime] = useState(employee.dutyEndTime ?? '')

  useEffect(() => {
    if (open) {
      setBranchId(employee.currentBranchId ?? '')
      setDepartmentId(employee.currentDepartmentId ?? '')
      setDutyStartTime(employee.dutyStartTime ?? '')
      setDutyEndTime(employee.dutyEndTime ?? '')
    }
  }, [open, employee])

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
    enabled: open,
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', branchId],
    queryFn: () => departmentsApi.getAll({ branchId }),
    enabled: open && !!branchId,
  })

  const mutation = useMutation({
    mutationFn: () =>
      employeesApi.updateBranchDuty(employee.id, {
        currentBranchId: branchId || undefined,
        currentDepartmentId: departmentId || undefined,
        dutyStartTime: dutyStartTime || undefined,
        dutyEndTime: dutyEndTime || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Branch and duty time updated' })
      onSuccess()
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Update failed',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Update Branch & Duty Time</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-border bg-surface p-3 space-y-1">
            <p>
              <span className="text-text-secondary">Current Branch: </span>
              {formatBranchLabel(employee.currentBranch)}
            </p>
            <p>
              <span className="text-text-secondary">Current Department: </span>
              {employee.currentDepartment?.name ?? '—'}
            </p>
            <p>
              <span className="text-text-secondary">Current Duty: </span>
              {formatDutyDisplay(employee.dutyStartTime, employee.dutyEndTime)}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Branch</Label>
            <Select
              value={branchId}
              onValueChange={(v) => {
                setBranchId(v)
                setDepartmentId('')
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {formatBranchLabel(b)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Department</Label>
            <Select
              value={departmentId}
              onValueChange={setDepartmentId}
              disabled={!branchId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Duty Start Time</Label>
              <Select value={dutyStartTime} onValueChange={setDutyStartTime}>
                <SelectTrigger>
                  <SelectValue placeholder="Select start time" />
                </SelectTrigger>
                <SelectContent>
                  {dutyTimeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Duty End Time</Label>
              <Select value={dutyEndTime} onValueChange={setDutyEndTime}>
                <SelectTrigger>
                  <SelectValue placeholder="Select end time" />
                </SelectTrigger>
                <SelectContent>
                  {dutyTimeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
            Changing the branch will create a transfer record in employment
            history.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
