import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { attendanceApi } from '@/api/endpoints/attendance'
import { branchesApi } from '@/api/endpoints/branches'
import { employeesApi } from '@/api/endpoints/employees'
import { leaveApi } from '@/api/endpoints/leave'
import {
  ApproveRejectDialog,
  canApproveLeave,
} from '@/components/leave/ApproveRejectDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
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
import { useAuth } from '@/hooks/useAuth'
import type { LeaveRecord } from '@/types'

export function BranchManagerDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const today = format(new Date(), 'yyyy-MM-dd')
  const [reviewLeave, setReviewLeave] = useState<LeaveRecord | null>(null)
  const [selectedBranchId, setSelectedBranchId] = useState('')

  const { data: myEmployee } = useQuery({
    queryKey: ['my-employee', user?.employeeId],
    queryFn: () => employeesApi.getOne(user!.employeeId!),
    enabled: !!user?.employeeId,
  })

  const { data: branches = [], isLoading: loadingBranches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const employeeBranchId = myEmployee?.currentBranchId ?? undefined
  const branchId = employeeBranchId || selectedBranchId || undefined

  useEffect(() => {
    if (!employeeBranchId && branches.length > 0 && !selectedBranchId) {
      setSelectedBranchId(branches[0].id)
    }
  }, [employeeBranchId, branches, selectedBranchId])

  const { data: employees = [], isLoading: loadingEmployees } = useQuery({
    queryKey: ['employees', branchId],
    queryFn: () => employeesApi.getAll({ branchId, status: 'ACTIVE' }),
    enabled: !!branchId,
  })

  const { data: attendance = [] } = useQuery({
    queryKey: ['attendance', today, branchId],
    queryFn: () =>
      attendanceApi.getAll({ startDate: today, endDate: today, branchId }),
    enabled: !!branchId,
  })

  const { data: pendingLeaves = [], refetch } = useQuery({
    queryKey: ['leave', 'pending-branch', branchId],
    queryFn: () =>
      leaveApi.getAll({
        pendingForRole: 'BRANCH_MANAGER',
        branchId,
        year: new Date().getFullYear(),
      }),
    enabled: !!branchId,
  })

  const present = attendance.filter((l) => l.status === 'PRESENT').length
  const absent = attendance.filter((l) => l.status === 'ABSENT').length
  const late = attendance.filter((l) => l.status === 'LATE').length
  const onLeave = attendance.filter((l) => l.status === 'ON_LEAVE').length

  const reviewRole = reviewLeave
    ? canApproveLeave(user?.role, reviewLeave)
    : null

  return (
    <div className="space-y-6">
      {!employeeBranchId && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
            <div className="space-y-2">
              <Label>Select Branch</Label>
              {loadingBranches ? (
                <Skeleton className="h-10 w-[280px]" />
              ) : (
                <Select
                  value={selectedBranchId}
                  onValueChange={setSelectedBranchId}
                >
                  <SelectTrigger className="w-[280px]">
                    <SelectValue placeholder="Choose a branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <p className="text-sm text-text-secondary">
              Your account is not linked to an employee record — choose a branch
              to view its dashboard.
            </p>
          </CardContent>
        </Card>
      )}

      {!branchId ? (
        <Card>
          <CardContent className="p-6 text-sm text-text-secondary">
            Select a branch to load attendance and leave data.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-6">
                {loadingEmployees ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <p className="text-3xl font-bold">{employees.length}</p>
                )}
                <p className="text-sm text-text-secondary">My Branch Employees</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-3xl font-bold">{present}</p>
                <p className="text-sm text-text-secondary">Present Today</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-3xl font-bold">{pendingLeaves.length}</p>
                <p className="text-sm text-text-secondary">
                  Pending Leave Approvals
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-3xl font-bold">{onLeave}</p>
                <p className="text-sm text-text-secondary">On Leave Today</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Pending Leave Requests</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingLeaves.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-text-secondary">
                        No pending approvals
                      </TableCell>
                    </TableRow>
                  ) : (
                    (pendingLeaves as LeaveRecord[]).map((leave) => (
                      <TableRow key={leave.id}>
                        <TableCell>
                          {leave.employee
                            ? `${leave.employee.firstName} ${leave.employee.lastName}`
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {format(new Date(leave.startDate), 'dd/MM/yyyy')}
                        </TableCell>
                        <TableCell>
                          {format(new Date(leave.endDate), 'dd/MM/yyyy')}
                        </TableCell>
                        <TableCell>{leave.totalDays}</TableCell>
                        <TableCell>{leave.leaveType ?? 'REGULAR'}</TableCell>
                        <TableCell className="max-w-[160px] truncate">
                          {leave.reason ?? '—'}
                        </TableCell>
                        <TableCell>
                          {canApproveLeave(user?.role, leave) && (
                            <Button
                              size="sm"
                              onClick={() => setReviewLeave(leave)}
                            >
                              Review
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s Attendance Summary</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-4 text-sm">
              <span>Present: {present}</span>
              <span>Absent: {absent}</span>
              <span>Late: {late}</span>
              <span>On Leave: {onLeave}</span>
              <Button variant="link" onClick={() => navigate('/attendance')}>
                View Attendance
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {reviewLeave && reviewRole && (
        <ApproveRejectDialog
          leave={reviewLeave}
          role={reviewRole}
          open={!!reviewLeave}
          onOpenChange={(open) => !open && setReviewLeave(null)}
          onSuccess={() => refetch()}
        />
      )}
    </div>
  )
}
