import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { leaveApi } from '@/api/endpoints/leave'
import {
  ApproveRejectDialog,
  canApproveLeave,
} from '@/components/leave/ApproveRejectDialog'
import { StageBadge } from '@/components/leave/StageBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { formatBranchLabel } from '@/lib/formatBranchLabel'

export function HrOperationsDashboard() {
  const { user } = useAuth()
  const [reviewLeave, setReviewLeave] = useState<LeaveRecord | null>(null)
  const year = new Date().getFullYear()
  const month = new Date().getMonth() + 1

  const { data: queue = [], refetch } = useQuery({
    queryKey: ['leave', 'hr-queue'],
    queryFn: () =>
      leaveApi.getAll({ pendingForRole: 'HR_OPERATIONS_MANAGER', year }),
  })

  const { data: monthLeaves = [] } = useQuery({
    queryKey: ['leave', 'hr-month', year, month],
    queryFn: () => leaveApi.getAll({ year, month }),
  })

  const stats = useMemo(() => {
    const approved = (monthLeaves as LeaveRecord[]).filter(
      (l) => l.status === 'APPROVED',
    ).length
    const rejected = (monthLeaves as LeaveRecord[]).filter(
      (l) => l.status === 'REJECTED',
    ).length
    return { approved, rejected }
  }, [monthLeaves])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-3xl font-bold">{queue.length}</p>
            <p className="text-sm text-text-secondary">Pending Final Approvals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-3xl font-bold">{stats.approved}</p>
            <p className="text-sm text-text-secondary">Approved This Month</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-3xl font-bold">{stats.rejected}</p>
            <p className="text-sm text-text-secondary">Rejected This Month</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Final Approval Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(queue as LeaveRecord[]).map((leave) => (
                <TableRow key={leave.id}>
                  <TableCell>
                    {leave.employee
                      ? `${leave.employee.fullName}`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {formatBranchLabel(leave.employee?.currentBranch)}
                  </TableCell>
                  <TableCell>
                    {format(new Date(leave.startDate), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>
                    {format(new Date(leave.endDate), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>
                    <StageBadge
                      status={leave.status}
                      currentStage={leave.currentStage}
                    />
                  </TableCell>
                  <TableCell>
                    {canApproveLeave(user?.role, leave) && (
                      <Button size="sm" onClick={() => setReviewLeave(leave)}>
                        Final Review
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leave Statistics This Month</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-6 text-sm">
          <span className="text-green-700">Approved: {stats.approved}</span>
          <span className="text-red-700">Rejected: {stats.rejected}</span>
        </CardContent>
      </Card>

      {reviewLeave && (
        <ApproveRejectDialog
          leave={reviewLeave}
          role={
            canApproveLeave(user?.role, reviewLeave) ??
            'HR_OPERATIONS_MANAGER'
          }
          open={!!reviewLeave}
          onOpenChange={(open) => !open && setReviewLeave(null)}
          onSuccess={() => refetch()}
        />
      )}
    </div>
  )
}
