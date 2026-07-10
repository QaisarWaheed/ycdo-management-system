import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { employeesApi } from '@/api/endpoints/employees'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { StatusBadge } from '@/components/employees/StatusBadge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import type { Department, Employee } from '@/types'

export type DepartmentWithEmployees = Department & {
  branch?: { name: string; address?: string | null }
  _count?: { employees: number }
}

export function getDepartmentEmployeeCount(dept: DepartmentWithEmployees) {
  return dept._count?.employees ?? 0
}

export function DepartmentEmployeesDialog({
  department,
  open,
  onOpenChange,
}: {
  department: DepartmentWithEmployees | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['department-employees', department?.id],
    queryFn: () =>
      employeesApi.getAll({ departmentId: department!.id }),
    enabled: open && !!department?.id,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{department?.name} — Employees</DialogTitle>
          {department?.branch && (
            <p className="text-sm text-text-secondary">
              {formatBranchLabel(department.branch)}
            </p>
          )}
        </DialogHeader>

        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(4)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(5)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : employees.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-text-secondary"
                  >
                    No employees in this department
                  </TableCell>
                </TableRow>
              ) : (
                (employees as Employee[]).map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-mono text-sm">
                      {emp.employeeCode}
                    </TableCell>
                    <TableCell>
                      <EmployeeNameLink employee={emp} />
                    </TableCell>
                    <TableCell>{emp.currentDesignation ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge status={emp.status} />
                    </TableCell>
                    <TableCell>
                      {emp.joiningDate
                        ? format(new Date(emp.joiningDate), 'dd/MM/yyyy')
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
