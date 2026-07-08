import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { SearchableSelect } from '@/components/common/SearchableSelect'
import { DutyHoursFields } from '@/components/employees/DutyHoursFields'
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
import { formatDutyDisplay } from '@/lib/dutyTimes'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import { findDepartmentByName } from '@/lib/inlineMasterData'
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
  const [dutyTotalHours, setDutyTotalHours] = useState<number | ''>(
    employee.dutyTotalHours ?? '',
  )
  const [dutyStartTime, setDutyStartTime] = useState(
    employee.dutyStartTime ?? '',
  )
  const [dutyEndTime, setDutyEndTime] = useState(employee.dutyEndTime ?? '')

  useEffect(() => {
    if (open) {
      setBranchId(employee.currentBranchId ?? '')
      setDepartmentId(employee.currentDepartmentId ?? '')
      setDutyTotalHours(employee.dutyTotalHours ?? '')
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
        dutyTotalHours:
          dutyTotalHours !== '' ? Number(dutyTotalHours) : undefined,
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
              {employee.dutyTotalHours
                ? ` (${employee.dutyTotalHours}h/day)`
                : ''}
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

          <SearchableSelect
            label="Department"
            options={departments.map((d) => d.name)}
            value={departments.find((d) => d.id === departmentId)?.name ?? ''}
            onChange={(name) => {
              const dept = findDepartmentByName(departments, name)
              if (dept) {
                setDepartmentId(dept.id)
              }
            }}
            placeholder="Select department"
            disabled={!branchId}
            error={
              employee.currentDepartmentId == null && !departmentId
                ? 'Department is required'
                : undefined
            }
          />

          <DutyHoursFields
            totalHours={dutyTotalHours}
            startTime={dutyStartTime}
            endTime={dutyEndTime}
            onTotalHoursChange={setDutyTotalHours}
            onStartTimeChange={setDutyStartTime}
            onEndTimeChange={setDutyEndTime}
          />

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
