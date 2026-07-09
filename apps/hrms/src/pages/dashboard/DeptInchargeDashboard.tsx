import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { leaveApi } from '@/api/endpoints/leave'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import {
  ApproveRejectDialog,
  canApproveLeave,
  canAssignReliever,
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

export function DeptInchargeDashboard({
  onAssignReliever,
}: {
  onAssignReliever?: (leave: LeaveRecord) => void
}) {
  const { user } = useAuth()
  const [reviewLeave, setReviewLeave] = useState<LeaveRecord | null>(null)

  const { data: pendingLeaves = [], refetch } = useQuery({
    queryKey: ['leave', 'pending-dept'],
    queryFn: () =>
      leaveApi.getAll({
        pendingForRole: 'ADMIN_OFFICER',
        year: new Date().getFullYear(),
      }),
  })

  const { data: todayRelievers = [] } = useQuery({
    queryKey: ['today-relievers'],
    queryFn: () => leaveApi.getTodayRelievers(),
  })

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-3xl font-bold">{pendingLeaves.length}</p>
            <p className="text-sm text-text-secondary">Pending Dept Approvals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-3xl font-bold">{todayRelievers.length}</p>
            <p className="text-sm text-text-secondary">Reliever Assignments Today</p>
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
                <TableHead>Stage</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(pendingLeaves as LeaveRecord[]).map((leave) => (
                <TableRow key={leave.id}>
                  <TableCell>
                    <EmployeeNameLink employee={leave.employee} />
                  </TableCell>
                  <TableCell>
                    {format(new Date(leave.startDate), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>
                    {format(new Date(leave.endDate), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>{leave.totalDays}</TableCell>
                  <TableCell>
                    <StageBadge
                      status={leave.status}
                      currentStage={leave.currentStage}
                    />
                  </TableCell>
                  <TableCell className="flex gap-2">
                    {canApproveLeave(user?.role, leave) && (
                      <Button size="sm" onClick={() => setReviewLeave(leave)}>
                        Review
                      </Button>
                    )}
                    {canAssignReliever(user?.role, leave) && onAssignReliever && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onAssignReliever(leave)}
                      >
                        Assign Reliever
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {reviewLeave && (
        <ApproveRejectDialog
          leave={reviewLeave}
          role={
            canApproveLeave(user?.role, reviewLeave) ?? 'ADMIN_OFFICER'
          }
          open={!!reviewLeave}
          onOpenChange={(open) => !open && setReviewLeave(null)}
          onSuccess={() => refetch()}
        />
      )}
    </div>
  )
}
