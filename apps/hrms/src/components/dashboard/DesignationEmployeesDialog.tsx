import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import type { Designation } from '@/api/endpoints/designations'
import { employeesApi } from '@/api/endpoints/employees'
import { StatusBadge } from '@/components/employees/StatusBadge'
import { Badge } from '@/components/ui/badge'
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
import type { Employee } from '@/types'

export function getDesignationEmployeeCount(designation: Designation) {
  return designation.employees ?? 0
}

export function DesignationEmployeesDialog({
  designation,
  open,
  onOpenChange,
}: {
  designation: Designation | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['designation-employees', designation?.title],
    queryFn: () =>
      employeesApi.getAll({ designation: designation!.title }),
    enabled: open && !!designation?.title,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{designation?.title} — Employees</DialogTitle>
          {designation?.category && (
            <Badge variant="outline" className="w-fit">
              {designation.category}
            </Badge>
          )}
        </DialogHeader>

        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(4)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(6)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : employees.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-text-secondary"
                  >
                    No employees with this designation
                  </TableCell>
                </TableRow>
              ) : (
                (employees as Employee[]).map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-mono text-sm">
                      {emp.employeeCode}
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/employees/${emp.id}`}
                        className="font-medium text-primary hover:underline"
                        onClick={() => onOpenChange(false)}
                      >
                        {emp.fullName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {formatBranchLabel(emp.currentBranch)}
                    </TableCell>
                    <TableCell>
                      {emp.currentDepartment?.name ?? '—'}
                    </TableCell>
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
