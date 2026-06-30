import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  AlertTriangle,
  BarChart3,
  Briefcase,
  Building2,
  Calendar,
  Clock,
  GraduationCap,
  MapPin,
  PieChart,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react'
import { attendanceApi } from '@/api/endpoints/attendance'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { leaveApi } from '@/api/endpoints/leave'
import { branchChangeRequestApi } from '@/api/endpoints/branchChangeRequest'
import {
  ReportModal,
  type ReportColumnConfig,
  type ReportFilterConfig,
} from '@/components/reports/ReportModal'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { AttendanceLog, DistrictSummary, Employee } from '@/types'
import { formatBranchLabel } from '@/lib/formatBranchLabel'

const ALL = 'ALL'
const now = new Date()

const PIE_COLORS = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#14b8a6',
]

function DistrictPieChart({ data }: { data: DistrictSummary[] }) {
  const total = data.reduce((s, d) => s + d.total, 0)
  if (total === 0) return null

  let cumulative = 0
  const segments = data.map((d, i) => {
    const pct = (d.total / total) * 100
    const start = cumulative
    cumulative += pct
    return `${PIE_COLORS[i % PIE_COLORS.length]} ${start}% ${cumulative}%`
  })

  return (
    <div className="mb-4 flex flex-wrap items-center gap-6 rounded-lg border border-border p-4">
      <div
        className="h-36 w-36 shrink-0 rounded-full"
        style={{ background: `conic-gradient(${segments.join(', ')})` }}
      />
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={d.district} className="flex items-center gap-2 text-sm">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
            />
            <span>
              {d.district}: {d.total} ({((d.total / total) * 100).toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

type ReportDef = {
  id: string
  title: string
  description: string
  icon: React.ElementType
  filters: ReportFilterConfig[]
  columns: ReportColumnConfig[]
  filename: string
  fetchFn: (filters: Record<string, string>) => Promise<Record<string, unknown>[]>
  extraContent?: (results: Record<string, unknown>[]) => React.ReactNode
}

function useReportOptions() {
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const branchOptions = useMemo(
    () => [
      { value: ALL, label: 'All Branches' },
      ...branches.map((b) => ({ value: b.id, label: formatBranchLabel(b) })),
    ],
    [branches],
  )

  const { data: departments = [] } = useQuery({
    queryKey: ['departments-all'],
    queryFn: () => departmentsApi.getAll(),
  })

  const deptOptions = useMemo(
    () => [
      { value: ALL, label: 'All Departments' },
      ...departments.map((d) => ({ value: d.id, label: d.name })),
    ],
    [departments],
  )

  const statusOptions = [
    { value: ALL, label: 'All Statuses' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'TRAINEE', label: 'Trainee' },
    { value: 'APPOINTED', label: 'Appointed' },
    { value: 'SUSPENDED', label: 'Suspended' },
    { value: 'TERMINATED', label: 'Terminated' },
    { value: 'RESIGNED', label: 'Resigned' },
    { value: 'ON_LEAVE', label: 'On Leave' },
  ]

  const leaveStatusOptions = [
    { value: ALL, label: 'All Statuses' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
  ]

  const branchChangeStatusOptions = [
    { value: ALL, label: 'All Statuses' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
    { value: 'COMPLETED', label: 'Completed' },
  ]

  return { branchOptions, deptOptions, statusOptions, leaveStatusOptions, branchChangeStatusOptions }
}

function useReports(): ReportDef[] {
  const {
    branchOptions,
    deptOptions,
    statusOptions,
    leaveStatusOptions,
    branchChangeStatusOptions,
  } = useReportOptions()

  const defaultMonth = String(now.getMonth() + 1)
  const defaultYear = String(now.getFullYear())
  const defaultDate = format(now, 'yyyy-MM-dd')

  return useMemo(
    () => [
      {
        id: 'employee-master',
        title: 'Employee Master',
        description: 'Complete employee listing with branch, department, and status filters.',
        icon: Users,
        filename: 'employee_master',
        filters: [
          { key: 'branchId', label: 'Branch', type: 'select', options: branchOptions, defaultValue: ALL },
          { key: 'departmentId', label: 'Department', type: 'select', options: deptOptions, defaultValue: ALL },
          { key: 'status', label: 'Status', type: 'select', options: statusOptions, defaultValue: ALL },
        ],
        columns: [
          { key: 'employeeCode', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'designation', label: 'Designation' },
          { key: 'branch', label: 'Branch' },
          { key: 'department', label: 'Department' },
          { key: 'status', label: 'Status' },
          { key: 'phone', label: 'Phone' },
          { key: 'joiningDate', label: 'Joining Date' },
        ],
        fetchFn: async (f) => {
          const employees = await employeesApi.getAll({
            branchId: f.branchId !== ALL ? f.branchId : undefined,
            departmentId: f.departmentId !== ALL ? f.departmentId : undefined,
            status: f.status !== ALL ? f.status : undefined,
          })
          return (employees as Employee[]).map((e) => ({
            employeeCode: e.employeeCode,
            name: `${e.firstName} ${e.lastName}`,
            designation: e.currentDesignation,
            branch: formatBranchLabel(e.currentBranch),
            department: e.currentDepartment?.name ?? '—',
            status: e.status,
            phone: e.phone ?? '—',
            joiningDate: e.joiningDate
              ? format(new Date(e.joiningDate), 'dd/MM/yyyy')
              : '—',
          }))
        },
      },
      {
        id: 'employee-status',
        title: 'Employee Status',
        description: 'Grouped employee counts by employment status.',
        icon: BarChart3,
        filename: 'employee_status',
        filters: [],
        columns: [
          { key: 'status', label: 'Status' },
          { key: 'count', label: 'Count' },
        ],
        fetchFn: async () => {
          const employees = await employeesApi.getAll()
          const counts: Record<string, number> = {}
          for (const e of employees as Employee[]) {
            counts[e.status] = (counts[e.status] ?? 0) + 1
          }
          return Object.entries(counts).map(([status, count]) => ({ status, count }))
        },
      },
      {
        id: 'training-staff',
        title: 'Training Staff',
        description: 'All employees currently in trainee status.',
        icon: GraduationCap,
        filename: 'training_staff',
        filters: [],
        columns: [
          { key: 'employeeCode', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'designation', label: 'Designation' },
          { key: 'branch', label: 'Branch' },
          { key: 'joiningDate', label: 'Joining Date' },
        ],
        fetchFn: async () => {
          const employees = await employeesApi.getAll({ status: 'TRAINEE' })
          return (employees as Employee[]).map((e) => ({
            employeeCode: e.employeeCode,
            name: `${e.firstName} ${e.lastName}`,
            designation: e.currentDesignation,
            branch: formatBranchLabel(e.currentBranch),
            joiningDate: e.joiningDate
              ? format(new Date(e.joiningDate), 'dd/MM/yyyy')
              : '—',
          }))
        },
      },
      {
        id: 'appointed-staff',
        title: 'Appointed Staff',
        description: 'All employees with appointed status.',
        icon: UserCheck,
        filename: 'appointed_staff',
        filters: [],
        columns: [
          { key: 'employeeCode', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'designation', label: 'Designation' },
          { key: 'branch', label: 'Branch' },
          { key: 'joiningDate', label: 'Joining Date' },
        ],
        fetchFn: async () => {
          const employees = await employeesApi.getAll({ status: 'APPOINTED' })
          return (employees as Employee[]).map((e) => ({
            employeeCode: e.employeeCode,
            name: `${e.firstName} ${e.lastName}`,
            designation: e.currentDesignation,
            branch: formatBranchLabel(e.currentBranch),
            joiningDate: e.joiningDate
              ? format(new Date(e.joiningDate), 'dd/MM/yyyy')
              : '—',
          }))
        },
      },
      {
        id: 'daily-attendance',
        title: 'Daily Attendance',
        description: 'Attendance log for a specific date with branch and department filters.',
        icon: Clock,
        filename: 'daily_attendance',
        filters: [
          { key: 'date', label: 'Date', type: 'date', defaultValue: defaultDate },
          { key: 'branchId', label: 'Branch', type: 'select', options: branchOptions, defaultValue: ALL },
          { key: 'departmentId', label: 'Department', type: 'select', options: deptOptions, defaultValue: ALL },
        ],
        columns: [
          { key: 'employeeCode', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'branch', label: 'Branch' },
          { key: 'status', label: 'Status' },
          { key: 'checkIn', label: 'Check In' },
          { key: 'checkOut', label: 'Check Out' },
        ],
        fetchFn: async (f) => {
          const logs = await attendanceApi.getAll({
            startDate: f.date,
            endDate: f.date,
            branchId: f.branchId !== ALL ? f.branchId : undefined,
          })
          let result = logs as AttendanceLog[]
          if (f.departmentId !== ALL) {
            const employees = await employeesApi.getAll({ departmentId: f.departmentId })
            const ids = new Set(employees.map((e) => e.id))
            result = result.filter((l) => l.employeeId && ids.has(l.employeeId))
          }
          return result.map((l) => ({
            employeeCode: l.employee?.employeeCode ?? '—',
            name: l.employee
              ? `${l.employee.firstName} ${l.employee.lastName}`
              : '—',
            branch: formatBranchLabel(l.branch),
            status: l.status,
            checkIn: l.checkIn ? format(new Date(l.checkIn), 'HH:mm') : '—',
            checkOut: l.checkOut ? format(new Date(l.checkOut), 'HH:mm') : '—',
          }))
        },
      },
      {
        id: 'monthly-attendance',
        title: 'Monthly Attendance',
        description: 'Per-employee attendance summary for a given month.',
        icon: Calendar,
        filename: 'monthly_attendance',
        filters: [
          { key: 'month', label: 'Month', type: 'number', defaultValue: defaultMonth },
          { key: 'year', label: 'Year', type: 'number', defaultValue: defaultYear },
          { key: 'branchId', label: 'Branch', type: 'select', options: branchOptions, defaultValue: ALL },
        ],
        columns: [
          { key: 'employeeCode', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'present', label: 'Present' },
          { key: 'absent', label: 'Absent' },
          { key: 'late', label: 'Late' },
          { key: 'onLeave', label: 'On Leave' },
        ],
        fetchFn: async (f) => {
          const month = Number(f.month)
          const year = Number(f.year)
          const employees = await employeesApi.getAll({
            branchId: f.branchId !== ALL ? f.branchId : undefined,
          })
          const rows: Record<string, unknown>[] = []
          for (const emp of employees as Employee[]) {
            const summary = await attendanceApi.getSummary(emp.id, month, year)
            rows.push({
              employeeCode: emp.employeeCode,
              name: `${emp.firstName} ${emp.lastName}`,
              present: summary.present,
              absent: summary.absent,
              late: summary.late,
              onLeave: summary.onLeave,
            })
          }
          return rows
        },
      },
      {
        id: 'late-arrival',
        title: 'Late Arrival',
        description: 'Late arrival count per employee for a given month.',
        icon: AlertTriangle,
        filename: 'late_arrival',
        filters: [
          { key: 'month', label: 'Month', type: 'number', defaultValue: defaultMonth },
          { key: 'year', label: 'Year', type: 'number', defaultValue: defaultYear },
          { key: 'branchId', label: 'Branch', type: 'select', options: branchOptions, defaultValue: ALL },
        ],
        columns: [
          { key: 'employeeCode', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'lateCount', label: 'Late Count' },
          { key: 'totalLateMinutes', label: 'Total Late Minutes' },
        ],
        fetchFn: async (f) => {
          const month = Number(f.month)
          const year = Number(f.year)
          const lastDay = new Date(year, month, 0).getDate()
          const startDate = `${year}-${String(month).padStart(2, '0')}-01`
          const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

          const logs = await attendanceApi.getAll({
            startDate,
            endDate,
            branchId: f.branchId !== ALL ? f.branchId : undefined,
            status: 'LATE',
          })

          const grouped: Record<string, { code: string; name: string; count: number; minutes: number }> = {}
          for (const log of logs as AttendanceLog[]) {
            const id = log.employeeId ?? 'unknown'
            if (!grouped[id]) {
              grouped[id] = {
                code: log.employee?.employeeCode ?? '—',
                name: log.employee
                  ? `${log.employee.firstName} ${log.employee.lastName}`
                  : '—',
                count: 0,
                minutes: 0,
              }
            }
            grouped[id].count++
            grouped[id].minutes += log.lateMinutes ?? 0
          }

          return Object.values(grouped).map((g) => ({
            employeeCode: g.code,
            name: g.name,
            lateCount: g.count,
            totalLateMinutes: g.minutes,
          }))
        },
      },
      {
        id: 'absent-report',
        title: 'Absent Report',
        description: 'Absent employees within a date range and branch.',
        icon: UserX,
        filename: 'absent_report',
        filters: [
          { key: 'startDate', label: 'Start Date', type: 'date', defaultValue: defaultDate },
          { key: 'endDate', label: 'End Date', type: 'date', defaultValue: defaultDate },
          { key: 'branchId', label: 'Branch', type: 'select', options: branchOptions, defaultValue: ALL },
        ],
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'employeeCode', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'branch', label: 'Branch' },
          { key: 'status', label: 'Status' },
        ],
        fetchFn: async (f) => {
          const logs = await attendanceApi.getAll({
            startDate: f.startDate,
            endDate: f.endDate,
            branchId: f.branchId !== ALL ? f.branchId : undefined,
            status: 'ABSENT',
          })
          return (logs as AttendanceLog[]).map((l) => ({
            date: format(new Date(l.date), 'dd/MM/yyyy'),
            employeeCode: l.employee?.employeeCode ?? '—',
            name: l.employee
              ? `${l.employee.firstName} ${l.employee.lastName}`
              : '—',
            branch: formatBranchLabel(l.branch),
            status: l.status,
          }))
        },
      },
      {
        id: 'leave-report',
        title: 'Leave Report',
        description: 'Leave requests filtered by month, year, status, and employee.',
        icon: Calendar,
        filename: 'leave_report',
        filters: [
          { key: 'month', label: 'Month', type: 'number', defaultValue: defaultMonth },
          { key: 'year', label: 'Year', type: 'number', defaultValue: defaultYear },
          { key: 'status', label: 'Status', type: 'select', options: leaveStatusOptions, defaultValue: ALL },
          { key: 'employeeId', label: 'Employee ID', type: 'text', defaultValue: '' },
        ],
        columns: [
          { key: 'employeeCode', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'startDate', label: 'From' },
          { key: 'endDate', label: 'To' },
          { key: 'totalDays', label: 'Days' },
          { key: 'status', label: 'Status' },
          { key: 'reason', label: 'Reason' },
        ],
        fetchFn: async (f) => {
          const leaves = await leaveApi.getAll({
            month: Number(f.month),
            year: Number(f.year),
            status: f.status !== ALL ? f.status : undefined,
            employeeId: f.employeeId || undefined,
          })
          return leaves.map((l) => ({
            employeeCode: l.employee?.employeeCode ?? '—',
            name: l.employee
              ? `${l.employee.firstName} ${l.employee.lastName}`
              : '—',
            startDate: format(new Date(l.startDate), 'dd/MM/yyyy'),
            endDate: format(new Date(l.endDate), 'dd/MM/yyyy'),
            totalDays: l.totalDays,
            status: l.status,
            reason: l.reason ?? '—',
          }))
        },
      },
      {
        id: 'branch-change-report',
        title: 'Branch Change Request Report',
        description: 'Branch change requests by district, status, and date range.',
        icon: MapPin,
        filename: 'branch_change_report',
        filters: [
          { key: 'district', label: 'District', type: 'text', defaultValue: '' },
          { key: 'status', label: 'Status', type: 'select', options: branchChangeStatusOptions, defaultValue: ALL },
          { key: 'startDate', label: 'Start Date', type: 'date', defaultValue: '' },
          { key: 'endDate', label: 'End Date', type: 'date', defaultValue: '' },
        ],
        columns: [
          { key: 'employeeCode', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'district', label: 'District' },
          { key: 'purpose', label: 'Purpose' },
          { key: 'startDate', label: 'From' },
          { key: 'endDate', label: 'To' },
          { key: 'duration', label: 'Duration' },
          { key: 'status', label: 'Status' },
        ],
        fetchFn: async (f) => {
          const requests = await branchChangeRequestApi.getAll({
            district: f.district || undefined,
            status: f.status !== ALL ? f.status : undefined,
            startDate: f.startDate || undefined,
            endDate: f.endDate || undefined,
          })
          return requests.map((r) => ({
            employeeCode: r.employee?.employeeCode ?? '—',
            name: r.employee
              ? `${r.employee.firstName} ${r.employee.lastName}`
              : '—',
            district: r.district,
            purpose: r.purpose,
            startDate: format(new Date(r.startDate), 'dd/MM/yyyy'),
            endDate: format(new Date(r.endDate), 'dd/MM/yyyy'),
            duration: `${r.duration}d`,
            status: r.status,
          }))
        },
      },
      {
        id: 'district-summary',
        title: 'District Summary',
        description: 'Branch change requests grouped by district with visual breakdown.',
        icon: PieChart,
        filename: 'district_summary',
        filters: [],
        columns: [
          { key: 'district', label: 'District' },
          { key: 'total', label: 'Total' },
          { key: 'approved', label: 'Approved' },
          { key: 'pending', label: 'Pending' },
          { key: 'rejected', label: 'Rejected' },
        ],
        fetchFn: async () => {
          const data = await branchChangeRequestApi.getDistrictSummary()
          return [...data]
            .sort((a, b) => b.total - a.total)
            .map((d) => ({
              district: d.district,
              total: d.total,
              approved: d.approved,
              pending: d.pending,
              rejected: d.rejected,
            }))
        },
        extraContent: (results) => (
          <DistrictPieChart
            data={results.map((r) => ({
              district: String(r.district),
              total: Number(r.total),
              approved: Number(r.approved),
              pending: Number(r.pending),
              rejected: Number(r.rejected),
            }))}
          />
        ),
      },
      {
        id: 'branch-wise-employee',
        title: 'Branch-wise Employee',
        description: 'Employee count breakdown by department within a branch.',
        icon: Building2,
        filename: 'branch_wise_employee',
        filters: [
          { key: 'branchId', label: 'Branch', type: 'select', options: branchOptions.filter((b) => b.value !== ALL), defaultValue: branchOptions[1]?.value ?? '' },
        ],
        columns: [
          { key: 'department', label: 'Department' },
          { key: 'count', label: 'Employee Count' },
        ],
        fetchFn: async (f) => {
          const employees = await employeesApi.getAll({
            branchId: f.branchId || undefined,
          })
          const counts: Record<string, number> = {}
          for (const e of employees as Employee[]) {
            const dept = e.currentDepartment?.name ?? 'Unassigned'
            counts[dept] = (counts[dept] ?? 0) + 1
          }
          return Object.entries(counts)
            .map(([department, count]) => ({ department, count }))
            .sort((a, b) => Number(b.count) - Number(a.count))
        },
      },
      {
        id: 'department-wise-employee',
        title: 'Department-wise Employee',
        description: 'Employee listing filtered by department.',
        icon: Briefcase,
        filename: 'department_wise_employee',
        filters: [
          { key: 'departmentId', label: 'Department', type: 'select', options: deptOptions.filter((d) => d.value !== ALL), defaultValue: deptOptions[1]?.value ?? '' },
        ],
        columns: [
          { key: 'employeeCode', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'designation', label: 'Designation' },
          { key: 'branch', label: 'Branch' },
          { key: 'status', label: 'Status' },
        ],
        fetchFn: async (f) => {
          const employees = await employeesApi.getAll({
            departmentId: f.departmentId || undefined,
          })
          return (employees as Employee[]).map((e) => ({
            employeeCode: e.employeeCode,
            name: `${e.firstName} ${e.lastName}`,
            designation: e.currentDesignation,
            branch: formatBranchLabel(e.currentBranch),
            status: e.status,
          }))
        },
      },
    ],
    [
      branchOptions,
      deptOptions,
      statusOptions,
      leaveStatusOptions,
      branchChangeStatusOptions,
      defaultDate,
      defaultMonth,
      defaultYear,
    ],
  )
}

export function ReportsPage() {
  const reports = useReports()
  const [activeReport, setActiveReport] = useState<ReportDef | null>(null)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Reports</h1>
      <p className="text-text-secondary">
        Generate and export HR reports across employees, attendance, leave, and branch change requests.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {reports.map((report) => {
          const Icon = report.icon
          return (
            <Card key={report.id} className="border-border shadow-sm">
              <CardHeader>
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-lg">{report.title}</CardTitle>
                <CardDescription>{report.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full bg-primary hover:bg-primary-dark"
                  onClick={() => setActiveReport(report)}
                >
                  Generate Report
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {activeReport && (
        <ReportModal
          open={!!activeReport}
          onOpenChange={(open) => !open && setActiveReport(null)}
          reportTitle={activeReport.title}
          filters={activeReport.filters}
          columns={activeReport.columns}
          fetchFn={activeReport.fetchFn}
          filename={activeReport.filename}
          extraContent={activeReport.extraContent}
        />
      )}
    </div>
  )
}
