import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { MoreHorizontal, Plus, Search, Users } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { employeesApi } from '@/api/endpoints/employees'
import { shiftsApi } from '@/api/endpoints/shifts'
import { ChangeStatusDialog } from '@/components/employees/ChangeStatusDialog'
import {
  createEmployeeFilters,
  EmployeeFiltersBar,
  employeeFiltersToParams,
} from '@/components/employees/EmployeeFiltersBar'
import { GenerateLetterDialog } from '@/components/employees/GenerateLetterDialog'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { EmployeeAvatar } from '@/components/employees/EmployeeAvatar'
import { StatusBadge } from '@/components/employees/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TablePagination } from '@/components/common/TablePagination'
import { TableRecordCount } from '@/components/common/TableRecordCount'
import { useAuth } from '@/hooks/useAuth'
import { useDebounce } from '@/hooks/useDebounce'
import { usePagination } from '@/hooks/usePagination'
import { formatBranchTableLabel } from '@/lib/formatBranchLabel'
import { formatEmployeeShiftDisplay } from '@/lib/dutyTimes'
import { sortEmployeesByHierarchy } from '@/lib/employeeHierarchy'
import { isMedicineManagerRole } from '@/lib/medicineScope'
import { withReturnTo } from '@/lib/backNavigation'
import { resolveFileUrl } from '@/lib/resolveFileUrl'

export function EmployeesListPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}`
  const { user, hasPermission } = useAuth()
  const isMedicineManager = isMedicineManagerRole(user?.role)
  const canCreateEmployee =
    !isMedicineManager && hasPermission('EMPLOYEES_CREATE')
  const canManageEmployee =
    !isMedicineManager && hasPermission('EMPLOYEES_EDIT')
  const [search, setSearch] = useState('')
  const [employeeFilters, setEmployeeFilters] = useState(() =>
    createEmployeeFilters(user),
  )

  const [letterDialog, setLetterDialog] = useState<string | null>(null)
  const [statusDialog, setStatusDialog] = useState<{
    id: string
    status: string
  } | null>(null)

  const debouncedSearch = useDebounce(search, 400)

  const { data: stats } = useQuery({
    queryKey: ['employees', 'stats'],
    queryFn: () => employeesApi.getStats(),
  })

  const unassignedCount = stats?.unassigned ?? 0

  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {}
    stats?.byStatus.forEach((row) => {
      map[row.status] = row.count
    })
    return map
  }, [stats])

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => shiftsApi.getAll(),
  })

  const filters = useMemo(
    () => ({
      ...employeeFiltersToParams(employeeFilters, shifts),
      search: debouncedSearch || undefined,
    }),
    [debouncedSearch, employeeFilters, shifts],
  )

  const { data: employees = [], isLoading, isError } = useQuery({
    queryKey: ['employees', filters],
    queryFn: () => employeesApi.getAll(filters),
  })

  const sortedEmployees = useMemo(
    () => sortEmployeesByHierarchy(employees),
    [employees],
  )

  const { page, setPage, totalPages, paginated, total } = usePagination(
    sortedEmployees,
    [filters],
  )

  const clearFilters = () => {
    setSearch('')
    setEmployeeFilters(createEmployeeFilters(user))
    setPage(0)
  }

  const handleFiltersChange = (next: typeof employeeFilters) => {
    setEmployeeFilters(next)
    setPage(0)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-text-primary">Employees</h1>
        {canCreateEmployee && (
          <Button
            className="bg-primary hover:bg-primary-dark"
            onClick={() => navigate('/employees/new')}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Employee
          </Button>
        )}
      </div>

      {unassignedCount > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-medium">
            ⚠️ {unassignedCount} employees have no department or designation assigned.
          </p>
          <button
            type="button"
            className="text-left font-medium text-amber-900 underline hover:text-amber-950 sm:text-right"
            onClick={() => {
              setSearch('')
              setEmployeeFilters({
                ...createEmployeeFilters(user),
                employeeStatus: 'UNASSIGNED',
              })
              setPage(0)
            }}
          >
            Click here to filter and assign them.
          </button>
        </div>
      )}

      <div className="space-y-4 rounded-lg border border-border bg-white p-4">
        <div className="relative min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
          <Input
            placeholder="Search by name, code, CNIC, branch..."
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
          />
        </div>

          <EmployeeFiltersBar
            filters={employeeFilters}
            onChange={handleFiltersChange}
            statusCounts={statusCounts}
            unassignedCount={unassignedCount}
          />

        <div className="flex justify-end">
          <Button variant="outline" onClick={clearFilters}>
            Clear Filters
          </Button>
        </div>
      </div>

      <TableRecordCount
        count={total}
        total={stats?.total}
        label="employee"
      />

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Biometric ID</TableHead>
              <TableHead>Full Name</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joining Date</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(8)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={9} className="h-48 text-center">
                  <div className="flex flex-col items-center gap-2 text-red-600">
                    <Users className="h-10 w-10 opacity-40" />
                    <p>Failed to load employees</p>
                    <p className="max-w-md text-sm text-text-secondary">
                      The server could not return employee records. Redeploy the
                      API and ensure pending database migrations are applied.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-48 text-center">
                  <div className="flex flex-col items-center gap-2 text-text-secondary">
                    <Users className="h-10 w-10 opacity-40" />
                    <p>No employees found</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((emp) => (
                <TableRow key={emp.id}>
                  <TableCell>
                    <Badge variant="outline" className="font-mono">
                      {emp.employeeCode}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {emp.biometricId ?? '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <EmployeeAvatar
                        fullName={emp.fullName}
                        photoUrl={resolveFileUrl(emp.photoUrl)}
                        hideProfilePhoto={emp.hideProfilePhoto}
                        size="sm"
                      />
                      <EmployeeNameLink
                        employee={emp}
                        className="font-semibold"
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {emp.currentDesignation ?? '—'}
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">
                        {emp.currentDepartment?.name ?? '—'}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {formatBranchTableLabel(emp.currentBranch)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    {emp.shift ? (
                      <div>
                        <p className="font-medium">{emp.shift.name}</p>
                        <p className="text-xs text-text-secondary">
                          {formatEmployeeShiftDisplay(emp)}
                        </p>
                      </div>
                    ) : (
                      <span className="text-text-secondary">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={emp.status} />
                  </TableCell>
                  <TableCell>
                    {format(new Date(emp.joiningDate), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            navigate(
                              `/employees/${emp.id}`,
                              withReturnTo(returnTo),
                            )
                          }
                        >
                          View Profile
                        </DropdownMenuItem>
                        {canManageEmployee && (
                          <>
                            <DropdownMenuItem
                              onClick={() =>
                                navigate(
                                  `/employees/${emp.id}`,
                                  withReturnTo(returnTo),
                                )
                              }
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                setStatusDialog({
                                  id: emp.id,
                                  status: emp.status,
                                })
                              }
                            >
                              Change Status
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setLetterDialog(emp.id)}
                            >
                              Generate Letter
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <TablePagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPageChange={setPage}
        />
      </div>

      {letterDialog && (
        <GenerateLetterDialog
          open={!!letterDialog}
          onOpenChange={(open) => !open && setLetterDialog(null)}
          employeeId={letterDialog}
        />
      )}

      {statusDialog && (
        <ChangeStatusDialog
          open={!!statusDialog}
          onOpenChange={(open) => !open && setStatusDialog(null)}
          employeeId={statusDialog.id}
          currentStatus={statusDialog.status}
        />
      )}
    </div>
  )
}
