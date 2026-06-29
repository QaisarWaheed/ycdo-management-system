import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { attendanceApi } from '@/api/endpoints/attendance'
import { branchesApi } from '@/api/endpoints/branches'
import { disciplinaryApi } from '@/api/endpoints/disciplinary'
import { employeesApi } from '@/api/endpoints/employees'
import { incentivesApi } from '@/api/endpoints/incentives'
import { leaveApi } from '@/api/endpoints/leave'
import { StageBadge } from '@/components/leave/StageBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { LeaveRecord } from '@/types'

export function ExecutiveDashboard() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const year = new Date().getFullYear()
  const month = new Date().getMonth() + 1

  const { data: employees = [] } = useQuery({
    queryKey: ['employees', 'active'],
    queryFn: () => employeesApi.getAll({ status: 'ACTIVE' }),
  })

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: attendance = [] } = useQuery({
    queryKey: ['attendance', today],
    queryFn: () =>
      attendanceApi.getAll({ startDate: today, endDate: today }),
  })

  const { data: disciplinary = [] } = useQuery({
    queryKey: ['disciplinary', 'open'],
    queryFn: () => disciplinaryApi.getAll({ status: 'OPEN' }),
  })

  const { data: leaves = [] } = useQuery({
    queryKey: ['leave', 'executive', year, month],
    queryFn: () => leaveApi.getAll({ year, month }),
  })

  const { data: incentives = [] } = useQuery({
    queryKey: ['incentives', year, month],
    queryFn: () => incentivesApi.getAll({ year, month }),
  })

  const onLeaveToday = attendance.filter((l) => l.status === 'ON_LEAVE').length
  const recentDecisions = (leaves as LeaveRecord[]).filter((l) =>
    ['APPROVED', 'REJECTED'].includes(l.status),
  )

  const branchCounts = branches.map((b) => ({
    name: b.name,
    count: employees.filter((e) => e.currentBranchId === b.id).length,
  }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-3xl font-bold">{employees.length}</p>
            <p className="text-sm text-text-secondary">Active Employees</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-3xl font-bold">{onLeaveToday}</p>
            <p className="text-sm text-text-secondary">On Leave Today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-3xl font-bold">{branches.length}</p>
            <p className="text-sm text-text-secondary">Total Branches</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-3xl font-bold">{disciplinary.length}</p>
            <p className="text-sm text-text-secondary">Open Disciplinary Cases</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Leave Decisions This Month</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentDecisions.slice(0, 10).map((leave) => (
                <TableRow key={leave.id}>
                  <TableCell>
                    {leave.employee
                      ? `${leave.employee.firstName} ${leave.employee.lastName}`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {leave.employee?.currentBranch?.name ?? '—'}
                  </TableCell>
                  <TableCell>
                    {format(new Date(leave.startDate), 'dd/MM/yyyy')} —{' '}
                    {format(new Date(leave.endDate), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>
                    <StageBadge
                      status={leave.status}
                      currentStage={leave.currentStage}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branch-wise Employee Count</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead>Employees</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branchCounts.slice(0, 15).map((b) => (
                <TableRow key={b.name}>
                  <TableCell>{b.name}</TableCell>
                  <TableCell>{b.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Incentives This Month</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-secondary">
            {incentives.length} incentive record(s) added this month
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
