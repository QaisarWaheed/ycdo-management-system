import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { projectsApi } from '@/api/endpoints/projects'
import { shiftsApi } from '@/api/endpoints/shifts'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getShiftIdsForStartTime,
  getUniqueShiftStartTimes,
  shiftStartTimeFilterLabel,
} from '@/lib/shiftFilterUtils'
import { EMPLOYEE_STATUSES, GENDERS } from '@/types'
import { formatBranchLabel } from '@/lib/formatBranchLabel'

export const ALL_FILTER = 'ALL'

export type EmployeeFilterState = {
  projectId: string
  branchId: string
  departmentId: string
  designation: string
  employeeStatus: string
  district: string
  gender: string
  shiftStartTime: string
  joinedFrom: string
  joinedTo: string
}

export const EMPTY_EMPLOYEE_FILTERS: EmployeeFilterState = {
  projectId: '',
  branchId: '',
  departmentId: '',
  designation: '',
  employeeStatus: ALL_FILTER,
  district: ALL_FILTER,
  gender: ALL_FILTER,
  shiftStartTime: '',
  joinedFrom: '',
  joinedTo: '',
}

export function employeeFiltersToParams(
  filters: EmployeeFilterState,
  shifts: Array<{ id: string; startTime: string }> = [],
) {
  const shiftIds = filters.shiftStartTime
    ? getShiftIdsForStartTime(shifts, filters.shiftStartTime) || undefined
    : undefined

  return {
    projectId: filters.projectId || undefined,
    branchId: filters.branchId || undefined,
    departmentId: filters.departmentId || undefined,
    designation:
      filters.designation !== ALL_FILTER ? filters.designation : undefined,
    status:
      filters.employeeStatus !== ALL_FILTER ? filters.employeeStatus : undefined,
    district: filters.district !== ALL_FILTER ? filters.district : undefined,
    gender: filters.gender !== ALL_FILTER ? filters.gender : undefined,
    shiftIds,
    joinedFrom: filters.joinedFrom || undefined,
    joinedTo: filters.joinedTo || undefined,
  }
}

export function employeeFiltersToAttendanceParams(
  filters: EmployeeFilterState,
  shifts: Array<{ id: string; startTime: string }> = [],
) {
  const params = employeeFiltersToParams(filters, shifts)
  return {
    projectId: params.projectId,
    branchId: params.branchId,
    departmentId: params.departmentId,
    designation: params.designation,
    employeeStatus: params.status,
    district: params.district,
    gender: params.gender,
    shiftIds: params.shiftIds,
  }
}

type EmployeeFiltersBarProps = {
  filters: EmployeeFilterState
  onChange: (filters: EmployeeFilterState) => void
  className?: string
}

export function EmployeeFiltersBar({
  filters,
  onChange,
  className,
}: EmployeeFiltersBarProps) {
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(),
  })

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', filters.branchId || 'all'],
    queryFn: () =>
      departmentsApi.getAll(
        filters.branchId ? { branchId: filters.branchId } : undefined,
      ),
  })

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts', filters.branchId || 'all'],
    queryFn: () =>
      shiftsApi.getAll(filters.branchId ? filters.branchId : undefined),
  })

  const uniqueStartTimes = useMemo(
    () => getUniqueShiftStartTimes(shifts),
    [shifts],
  )

  const { data: filterOptions } = useQuery({
    queryKey: ['employees', 'filter-options'],
    queryFn: () => employeesApi.getFilterOptions(),
  })

  const filteredBranches = useMemo(() => {
    if (!filters.projectId) return branches
    return branches.filter((b) => b.projectId === filters.projectId)
  }, [branches, filters.projectId])

  const update = (patch: Partial<EmployeeFilterState>) => {
    onChange({ ...filters, ...patch })
  }

  const handleProjectChange = (value: string) => {
    update({
      projectId: value === 'all' ? '' : value,
      branchId: '',
      departmentId: '',
      shiftStartTime: '',
    })
  }

  const handleBranchChange = (value: string) => {
    update({
      branchId: value === 'all' ? '' : value,
      departmentId: '',
      shiftStartTime: '',
    })
  }

  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <div className="space-y-1">
          <Label>Project</Label>
          <Select
            value={filters.projectId || 'all'}
            onValueChange={handleProjectChange}
          >
            <SelectTrigger>
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Branch</Label>
          <Select
            value={filters.branchId || 'all'}
            onValueChange={handleBranchChange}
          >
            <SelectTrigger>
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {filteredBranches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {formatBranchLabel(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Department</Label>
          <Select
            value={filters.departmentId || 'all'}
            onValueChange={(v) =>
              update({ departmentId: v === 'all' ? '' : v })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Shift</Label>
          <Select
            value={filters.shiftStartTime || 'all'}
            onValueChange={(v) =>
              update({ shiftStartTime: v === 'all' ? '' : v })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="All Shifts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Shifts</SelectItem>
              {uniqueStartTimes.map((startTime) => (
                <SelectItem key={startTime} value={startTime}>
                  {shiftStartTimeFilterLabel(startTime)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Designation</Label>
          <Select
            value={filters.designation || ALL_FILTER}
            onValueChange={(v) => update({ designation: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="All Designations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>All Designations</SelectItem>
              {(filterOptions?.designations ?? []).map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Status</Label>
          <Select
            value={filters.employeeStatus}
            onValueChange={(v) => update({ employeeStatus: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>All Statuses</SelectItem>
              {EMPLOYEE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Location</Label>
          <Select
            value={filters.district}
            onValueChange={(v) => update({ district: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="All Locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>All Locations</SelectItem>
              {(filterOptions?.districts ?? []).map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Gender</Label>
          <Select
            value={filters.gender}
            onValueChange={(v) => update({ gender: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="All Genders" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>All Genders</SelectItem>
              {GENDERS.map((g) => (
                <SelectItem key={g} value={g}>
                  {g.charAt(0) + g.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Joined From</Label>
          <Input
            type="date"
            min="1990-01-01"
            max="2099-12-31"
            value={filters.joinedFrom}
            onChange={(e) => update({ joinedFrom: e.target.value })}
          />
        </div>

        <div className="space-y-1">
          <Label>Joined To</Label>
          <Input
            type="date"
            min="1990-01-01"
            max="2099-12-31"
            value={filters.joinedTo}
            onChange={(e) => update({ joinedTo: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}
