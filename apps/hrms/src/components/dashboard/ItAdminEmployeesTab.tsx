import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Search, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { employeesApi } from '@/api/endpoints/employees'
import { shiftsApi } from '@/api/endpoints/shifts'
import { TablePagination } from '@/components/common/TablePagination'
import { TableRecordCount } from '@/components/common/TableRecordCount'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EditEmployeeDialog } from '@/components/employees/EditEmployeeDialog'
import {
  EMPTY_EMPLOYEE_FILTERS,
  EmployeeFiltersBar,
  employeeFiltersToParams,
} from '@/components/employees/EmployeeFiltersBar'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { StatusBadge } from '@/components/employees/StatusBadge'
import { Button } from '@/components/ui/button'
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
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { useDebounce } from '@/hooks/useDebounce'
import { usePagination } from '@/hooks/usePagination'
import { formatBranchTableLabel } from '@/lib/formatBranchLabel'
import { sortEmployeesByHierarchy } from '@/lib/employeeHierarchy'
import type { Employee } from '@/types'

export function ItAdminEmployeesTab() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const canManagePersonal =
    user?.role === 'IT_ADMIN' || user?.role === 'SUPER_ADMIN'

  const [search, setSearch] = useState('')
  const [employeeFilters, setEmployeeFilters] =
    useState(EMPTY_EMPLOYEE_FILTERS)
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null)
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null)

  const debouncedSearch = useDebounce(search, 400)

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => shiftsApi.getAll(),
  })

  const filters = useMemo(
    () => ({
      ...employeeFiltersToParams(employeeFilters, shifts),
      search: debouncedSearch || undefined,
    }),
    [employeeFilters, debouncedSearch, shifts],
  )

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['it-admin-employees', filters],
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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => employeesApi.delete(id),
    onSuccess: (result) => {
      toast({ title: result.message })
      queryClient.invalidateQueries({ queryKey: ['it-admin-employees'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      setDeleteTarget(null)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to delete employee',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
        <Input
          placeholder="Search by name or employee code..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

        <EmployeeFiltersBar
          filters={employeeFilters}
          onChange={setEmployeeFilters}
        />

      <TableRecordCount count={total} label="employee" />

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Biometric ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Dept</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
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
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-text-secondary">
                  No employees found
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((emp) => (
                <TableRow key={emp.id}>
                  <TableCell className="font-mono text-sm">
                    {emp.employeeCode}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {emp.biometricId ?? '—'}
                  </TableCell>
                  <TableCell>
                    <EmployeeNameLink employee={emp} />
                  </TableCell>
                  <TableCell>{formatBranchTableLabel(emp.currentBranch)}</TableCell>
                  <TableCell>{emp.currentDepartment?.name ?? '—'}</TableCell>
                  <TableCell>{emp.currentDesignation ?? '—'}</TableCell>
                  <TableCell>
                    <StatusBadge status={emp.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {canManagePersonal && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            asChild
                          >
                            <Link to={`/employees/${emp.id}`}>
                              Manage
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const full = await employeesApi.getOne(emp.id)
                              setEditEmployee(full)
                            }}
                          >
                            <Pencil className="mr-1 h-4 w-4" />
                            Edit
                          </Button>
                        </>
                      )}
                      {canManagePersonal && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => setDeleteTarget(emp)}
                        >
                          <Trash2 className="mr-1 h-4 w-4" />
                          Delete
                        </Button>
                      )}
                    </div>
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

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Employee"
        description={
          deleteTarget
            ? `Permanently delete ${deleteTarget.fullName}? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete Permanently"
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
        }}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteMutation.isPending}
      />

      {editEmployee && (
        <EditEmployeeDialog
          employee={editEmployee}
          mode="personal"
          open={!!editEmployee}
          onOpenChange={(open) => !open && setEditEmployee(null)}
          canEditCnic
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['it-admin-employees'] })
            queryClient.invalidateQueries({ queryKey: ['employees'] })
            setEditEmployee(null)
          }}
        />
      )}
    </div>
  )
}
