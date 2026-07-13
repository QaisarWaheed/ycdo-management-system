import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { projectsApi } from '@/api/endpoints/projects'
import { shiftsApi } from '@/api/endpoints/shifts'
import { DateInput } from '@/components/common/DateInput'
import { SearchableSelect } from '@/components/common/SearchableSelect'
import { ShiftFilterDropdowns } from '@/components/employees/ShiftFilterDropdowns'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { resolveShiftIds } from '@/lib/shiftFilterUtils'
import { EMPLOYEE_STATUSES, GENDERS, type Shift } from '@/types'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import { getLockedBranchId } from '@/lib/branchScope'
import { useAuth } from '@/hooks/useAuth'
import {
  BLOOD_GROUP_OPTIONS,
  MARITAL_STATUS_LABELS,
  labelToMaritalStatus,
} from '@/lib/searchableSelectOptions'

export const ALL_FILTER = 'ALL'

export type EmployeeFilterState = {
  projectId: string
  branchId: string
  departmentId: string
  designation: string
  employeeStatus: string
  district: string
  gender: string
  maritalStatus: string
  bloodGroup: string
  shiftStartTime: string
  shiftId: string
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
  maritalStatus: ALL_FILTER,
  bloodGroup: ALL_FILTER,
  shiftStartTime: '',
  shiftId: '',
  joinedFrom: '',
  joinedTo: '',
}

export function createEmployeeFilters(
  user?: { role?: string | null; branchId?: string | null } | null,
): EmployeeFilterState {
  const lockedBranchId = getLockedBranchId(user)
  if (!lockedBranchId) {
    return { ...EMPTY_EMPLOYEE_FILTERS }
  }
  return {
    ...EMPTY_EMPLOYEE_FILTERS,
    branchId: lockedBranchId,
  }
}

export function employeeFiltersToParams(
  filters: EmployeeFilterState,
  shifts: Pick<Shift, 'id' | 'startTime'>[] = [],
) {
  return {
    projectId: filters.projectId || undefined,
    branchId: filters.branchId || undefined,
    departmentId: filters.departmentId || undefined,
    designation:
      filters.designation !== ALL_FILTER ? filters.designation : undefined,
    unassigned:
      filters.employeeStatus === 'UNASSIGNED' ? 'true' : undefined,
    status:
      filters.employeeStatus !== ALL_FILTER &&
      filters.employeeStatus !== 'UNASSIGNED'
        ? filters.employeeStatus
        : undefined,
    district: filters.district !== ALL_FILTER ? filters.district : undefined,
    gender:
      filters.maritalStatus === 'Widow'
        ? 'FEMALE'
        : filters.gender !== ALL_FILTER
          ? filters.gender
          : undefined,
    maritalStatus:
      filters.maritalStatus !== ALL_FILTER &&
      filters.maritalStatus !== 'Widow'
        ? labelToMaritalStatus(filters.maritalStatus)
        : undefined,
    widowOnly:
      filters.maritalStatus === 'Widow' ? 'true' : undefined,
    bloodGroup:
      filters.bloodGroup !== ALL_FILTER ? filters.bloodGroup : undefined,
    shiftIds: resolveShiftIds(
      filters.shiftStartTime,
      filters.shiftId,
      shifts,
    ),
    joinedFrom: filters.joinedFrom || undefined,
    joinedTo: filters.joinedTo || undefined,
  }
}

export function employeeFiltersToAttendanceParams(
  filters: EmployeeFilterState,
  shifts: Pick<Shift, 'id' | 'startTime'>[] = [],
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
    bloodGroup: params.bloodGroup,
    shiftIds: params.shiftIds,
  }
}

type EmployeeFiltersBarProps = {
  filters: EmployeeFilterState
  onChange: (filters: EmployeeFilterState) => void
  statusCounts?: Record<string, number>
  unassignedCount?: number
  className?: string
}

export function EmployeeFiltersBar({
  filters,
  onChange,
  statusCounts,
  unassignedCount,
  className,
}: EmployeeFiltersBarProps) {
  const { user } = useAuth()
  const lockedBranchId = getLockedBranchId(user)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(),
    enabled: !lockedBranchId,
  })

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
    enabled: !lockedBranchId,
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll(),
  })

  const { data: filterOptions } = useQuery({
    queryKey: ['employees', 'filter-options'],
    queryFn: () => employeesApi.getFilterOptions(),
  })

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => shiftsApi.getAll(),
  })

  const filteredBranches = useMemo(() => {
    if (!filters.projectId) return branches
    return branches.filter((b) => b.projectId === filters.projectId)
  }, [branches, filters.projectId])

  useEffect(() => {
    if (!lockedBranchId) return
    if (filters.branchId === lockedBranchId && !filters.projectId) return

    onChange({
      ...filters,
      projectId: '',
      branchId: lockedBranchId,
      ...(filters.branchId !== lockedBranchId
        ? {
            departmentId: '',
            shiftStartTime: '',
            shiftId: '',
          }
        : {}),
    })
  }, [lockedBranchId, filters.branchId, filters.projectId, filters, onChange])

  const update = (patch: Partial<EmployeeFilterState>) => {
    onChange({ ...filters, ...patch })
  }

  const handleProjectChange = (value: string) => {
    update({
      projectId: value === 'all' ? '' : value,
      branchId: '',
      departmentId: '',
      shiftStartTime: '',
      shiftId: '',
    })
  }

  const handleBranchChange = (value: string) => {
    update({
      branchId: value === 'all' ? '' : value,
      departmentId: '',
      shiftStartTime: '',
      shiftId: '',
    })
  }

  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {!lockedBranchId && (
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
        )}

        {!lockedBranchId && (
          <div className="space-y-1">
            <SearchableSelect
              label="Branch"
              options={[
                'All Branches',
                ...filteredBranches.map((b) => formatBranchLabel(b)),
              ]}
              value={(() => {
                if (!filters.branchId) return 'All Branches'
                const branch = filteredBranches.find(
                  (b) => b.id === filters.branchId,
                )
                return branch ? formatBranchLabel(branch) : 'All Branches'
              })()}
              onChange={(label) => {
                if (label === 'All Branches') {
                  handleBranchChange('all')
                  return
                }
                const branch = filteredBranches.find(
                  (b) => formatBranchLabel(b) === label,
                )
                if (branch) handleBranchChange(branch.id)
              }}
              placeholder="Search branch..."
            />
          </div>
        )}

        <div className="space-y-1">
          <SearchableSelect
            label="Department"
            options={[
              'All Departments',
              ...departments.map((d) => d.name),
            ]}
            value={
              filters.departmentId
                ? (departments.find((d) => d.id === filters.departmentId)?.name ??
                  '')
                : 'All Departments'
            }
            onChange={(label) => {
              if (label === 'All Departments') {
                update({ departmentId: '' })
                return
              }
              const dept = departments.find((d) => d.name === label)
              if (dept) update({ departmentId: dept.id })
            }}
            placeholder="Search department..."
          />
        </div>

        <ShiftFilterDropdowns
          shifts={shifts}
          shiftStartTime={filters.shiftStartTime}
          shiftId={filters.shiftId}
          onShiftStartTimeChange={(shiftStartTime) =>
            update({ shiftStartTime, shiftId: '' })
          }
          onShiftIdChange={(shiftId) => update({ shiftId })}
          className="contents"
        />

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
              <SelectItem value="UNASSIGNED">
                <span className="inline-flex items-center gap-2 rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                  Needs Assignment
                </span>
                {unassignedCount != null ? ` (${unassignedCount})` : ''}
              </SelectItem>
              {EMPLOYEE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                  {statusCounts?.[s] != null ? ` (${statusCounts[s]})` : ''}
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
          <Label>Blood Group</Label>
          <Select
            value={filters.bloodGroup}
            onValueChange={(v) => update({ bloodGroup: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="All Blood Groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>All Blood Groups</SelectItem>
              {BLOOD_GROUP_OPTIONS.map((bg) => (
                <SelectItem key={bg} value={bg}>
                  {bg}
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
          <SearchableSelect
            label="Marital Status"
            options={['All', ...MARITAL_STATUS_LABELS]}
            value={
              filters.maritalStatus === ALL_FILTER
                ? 'All'
                : filters.maritalStatus
            }
            onChange={(label) => {
              if (label === 'All') {
                update({ maritalStatus: ALL_FILTER })
                return
              }
              if (label === 'Widow') {
                update({ maritalStatus: 'Widow', gender: 'FEMALE' })
                return
              }
              update({ maritalStatus: label })
            }}
            placeholder="All"
          />
          {filters.maritalStatus === 'Widow' && (
            <p className="text-xs text-text-secondary" title="Only shows female staff">
              Only shows female staff
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label>Joined From</Label>
          <DateInput
            min="1990-01-01"
            max="2099-12-31"
            value={filters.joinedFrom}
            onChange={(value) => update({ joinedFrom: value })}
          />
        </div>

        <div className="space-y-1">
          <Label>Joined To</Label>
          <DateInput
            min="1990-01-01"
            max="2099-12-31"
            value={filters.joinedTo}
            onChange={(value) => update({ joinedTo: value })}
          />
        </div>
      </div>
    </div>
  )
}
