import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { MoreHorizontal, Plus, Search, Users } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { ChangeStatusDialog } from '@/components/employees/ChangeStatusDialog'
import { GenerateLetterDialog } from '@/components/employees/GenerateLetterDialog'
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
import { useDebounce } from '@/hooks/useDebounce'
import type { EmployeeStatus } from '@/types'

const PAGE_SIZE = 20
const ALL_STATUS = 'ALL'

export function EmployeesListPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [branchId, setBranchId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [status, setStatus] = useState<string>(ALL_STATUS)
  const [page, setPage] = useState(0)

  const [letterDialog, setLetterDialog] = useState<string | null>(null)
  const [statusDialog, setStatusDialog] = useState<{
    id: string
    status: string
  } | null>(null)

  const debouncedSearch = useDebounce(search, 400)

  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      branchId: branchId || undefined,
      departmentId: departmentId || undefined,
      status: status !== ALL_STATUS ? status : undefined,
    }),
    [debouncedSearch, branchId, departmentId, status],
  )

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employees', filters],
    queryFn: () => employeesApi.getAll(filters),
  })

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', branchId],
    queryFn: () => departmentsApi.getAll({ branchId }),
    enabled: !!branchId,
  })

  const totalPages = Math.max(1, Math.ceil(employees.length / PAGE_SIZE))
  const paginated = employees.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const clearFilters = () => {
    setSearch('')
    setBranchId('')
    setDepartmentId('')
    setStatus(ALL_STATUS)
    setPage(0)
  }

  const handleBranchChange = (value: string) => {
    setBranchId(value === 'all' ? '' : value)
    setDepartmentId('')
    setPage(0)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-text-primary">Employees</h1>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => navigate('/employees/new')}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Employee
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-4">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
          <Input
            placeholder="Search by name, code, CNIC..."
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
          />
        </div>

        <Select value={branchId || 'all'} onValueChange={handleBranchChange}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Branch" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Branches</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={departmentId || 'all'}
          onValueChange={(v) => {
            setDepartmentId(v === 'all' ? '' : v)
            setPage(0)
          }}
          disabled={!branchId}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Department" />
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

        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v)
            setPage(0)
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUS}>All Statuses</SelectItem>
            {(
              [
                'ACTIVE',
                'SUSPENDED',
                'TERMINATED',
                'RESIGNED',
                'ON_LEAVE',
              ] as EmployeeStatus[]
            ).map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" onClick={clearFilters}>
          Clear Filters
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Full Name</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joining Date</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(7)].map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-48 text-center">
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
                  <TableCell>
                    <Link
                      to={`/employees/${emp.id}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      {emp.firstName} {emp.lastName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {emp.currentDesignation}
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">
                        {emp.currentDepartment?.name ?? '—'}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {emp.currentBranch?.name ?? '—'}
                      </p>
                    </div>
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
                          onClick={() => navigate(`/employees/${emp.id}`)}
                        >
                          View Profile
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => navigate(`/employees/${emp.id}`)}
                        >
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            setStatusDialog({ id: emp.id, status: emp.status })
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
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {!isLoading && employees.length > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-sm text-text-secondary">
              Showing {page * PAGE_SIZE + 1}–
              {Math.min((page + 1) * PAGE_SIZE, employees.length)} of{' '}
              {employees.length}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
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
