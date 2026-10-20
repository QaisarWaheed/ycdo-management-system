import api from '@/api/axios'
import { useAuth } from '@/hooks/useAuth'
import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { SearchableSelect } from '@/components/common/SearchableSelect'
import { DutyHoursFields } from '@/components/employees/DutyHoursFields'
import { WeeklyOffDaysChecklist } from '@/components/employees/WeeklyOffDaysChecklist'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { isValidDutyTotalHours } from '@/lib/dutyHours'
import { formatEmployeeShiftDisplay } from '@/lib/dutyTimes'
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
  const [relieverOnly, setRelieverOnly] = useState(
    Boolean(employee.relieverOnly),
  )
  const [monthlyAllowedLeaves, setMonthlyAllowedLeaves] = useState<
    number | ''
  >(employee.monthlyAllowedLeaves ?? '')
  const [weeklyOffWeekdays, setWeeklyOffWeekdays] = useState<number[]>(
    employee.weeklyOffWeekdays ?? [],
  )

  useEffect(() => {
    if (open) {
      setBranchId(employee.currentBranchId ?? '')
      setDepartmentId(employee.currentDepartmentId ?? '')
      setDutyTotalHours(employee.dutyTotalHours ?? '')
      setDutyStartTime(employee.dutyStartTime ?? '')
      setDutyEndTime(employee.dutyEndTime ?? '')
      setRelieverOnly(Boolean(employee.relieverOnly))
      setMonthlyAllowedLeaves(employee.monthlyAllowedLeaves ?? '')
      setWeeklyOffWeekdays(employee.weeklyOffWeekdays ?? [])
    }
  }, [open, employee])

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
    enabled: open,
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll(),
    enabled: open,
  })

  // Req 16 / 17: only Super Admin changes branch / department / hours here;
  // others send a working-hours request (draft letter + HR Operations approval).
  const isSuperAdmin = useAuth().hasRole(['SUPER_ADMIN'])
  const [hoursEffective, setHoursEffective] = useState(new Date().toISOString().slice(0, 10))
  const [hoursReason, setHoursReason] = useState('')
  const branchChanged =
    (!!branchId && branchId !== (employee.currentBranchId ?? '')) ||
    (!!departmentId && departmentId !== (employee.currentDepartmentId ?? ''))
  const hoursChanged =
    (dutyStartTime || '') !== (employee.dutyStartTime ?? '') ||
    (dutyEndTime || '') !== (employee.dutyEndTime ?? '') ||
    (dutyTotalHours === '' ? null : Number(dutyTotalHours)) !== (employee.dutyTotalHours ?? null)
  const needsRequest = !isSuperAdmin && hoursChanged
  const mutation = useMutation({
    mutationFn: async () => {
      if (!isSuperAdmin && branchChanged) {
        throw { response: { data: { message: 'Branch / department change needs a Transfer request: use the Transfer button.' } } }
      }
      if (needsRequest) {
        await api.post('/employee-change-requests/working-hours', {
          employeeId: employee.id,
          dutyStartTime,
          dutyEndTime,
          dutyTotalHours: Number(dutyTotalHours),
          effectiveDate: hoursEffective,
          reason: hoursReason.trim(),
        })
      }
      return employeesApi.updateBranchDuty(employee.id, {
        ...(isSuperAdmin
          ? {
              currentBranchId: branchId || undefined,
              currentDepartmentId: departmentId || undefined,
              dutyTotalHours: dutyTotalHours !== '' ? Number(dutyTotalHours) : undefined,
              dutyStartTime: dutyStartTime || undefined,
              dutyEndTime: dutyEndTime || undefined,
            }
          : {}),
        relieverOnly,
        monthlyAllowedLeaves: monthlyAllowedLeaves === '' ? null : Number(monthlyAllowedLeaves),
        weeklyOffWeekdays,
      })
    },
    onSuccess: () => {
      toast({
        title: needsRequest
          ? 'Working-hours request sent to the executives; draft letter created (send it from Letters). Other settings saved.'
          : 'Branch and duty time updated',
      })
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
              {formatEmployeeShiftDisplay(employee)}
              {employee.dutyTotalHours
                ? ` (${employee.dutyTotalHours}h/day)`
                : ''}
            </p>
          </div>

          <SearchableSelect
            label="Branch"
            options={branches.map((b) => formatBranchLabel(b))}
            value={
              branches.find((b) => b.id === branchId)
                ? formatBranchLabel(branches.find((b) => b.id === branchId)!)
                : ''
            }
            onChange={(label) => {
              const branch = branches.find((b) => formatBranchLabel(b) === label)
              if (!branch) return
              setBranchId(branch.id)
              setDepartmentId('')
            }}
            placeholder="Search branch..."
          />

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
            placeholder="Search department..."
            disabled={!branchId}
            error={
              employee.currentDepartmentId == null && !departmentId
                ? 'Department is required'
                : undefined
            }
          />

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-primary"
              checked={relieverOnly}
              onChange={(e) => setRelieverOnly(e.target.checked)}
            />
            <span>
              <span className="font-medium">Reliever only</span>
              <span className="mt-0.5 block text-text-secondary">
                No regular duty roster. Will not be auto-marked absent; used only
                when covering as a reliever.
              </span>
            </span>
          </label>

          {!relieverOnly && (
            <DutyHoursFields
              totalHours={dutyTotalHours}
              startTime={dutyStartTime}
              endTime={dutyEndTime}
              onTotalHoursChange={setDutyTotalHours}
              onStartTimeChange={setDutyStartTime}
              onEndTimeChange={setDutyEndTime}
            />
          )}

          <WeeklyOffDaysChecklist
            value={weeklyOffWeekdays}
            onChange={setWeeklyOffWeekdays}
          />

          <div className="space-y-1">
            <Label htmlFor="monthlyAllowedLeaves">Allow leave / month</Label>
            <Input
              id="monthlyAllowedLeaves"
              type="number"
              min={0}
              max={31}
              placeholder="Blank = unlimited paid leave"
              value={monthlyAllowedLeaves}
              onChange={(e) => {
                const v = e.target.value
                setMonthlyAllowedLeaves(v === '' ? '' : Number.parseInt(v, 10))
              }}
            />
            <p className="text-xs text-text-secondary">
              First N leave days each month stay paid; any extra leave is unpaid
              and deducted from stipend.
            </p>
          </div>

          {needsRequest ? (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-amber-800">
                New working hours need a letter and HR Operations approval. They apply only after approval.
              </p>
              <div className="space-y-1">
                <Label htmlFor="hoursEffective">Effective from</Label>
                <Input id="hoursEffective" type="date" value={hoursEffective} onChange={(e) => setHoursEffective(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="hoursReason">Reason</Label>
                <Input id="hoursReason" value={hoursReason} onChange={(e) => setHoursReason(e.target.value)} />
              </div>
            </div>
          ) : null}
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
            {isSuperAdmin
              ? 'Changing the branch will create a transfer record in employment history.'
              : 'Branch / department changes go through the Transfer button (letter + HR Operations approval).'}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={mutation.isPending || (needsRequest && hoursReason.trim().length < 3)}
            onClick={() => {
              if (
                !relieverOnly &&
                dutyTotalHours !== '' &&
                !isValidDutyTotalHours(Number(dutyTotalHours))
              ) {
                toast({
                  title: 'Invalid duty hours',
                  description:
                    'Use half-hour steps from 0.5 to 24, e.g. 5.5 or 6.5.',
                  variant: 'destructive',
                })
                return
              }
              mutation.mutate()
            }}
          >
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
