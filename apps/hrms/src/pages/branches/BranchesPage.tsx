import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronDown, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { branchesApi } from '@/api/endpoints/branches'
import { employeesApi } from '@/api/endpoints/employees'
import { projectsApi } from '@/api/endpoints/projects'
import { EmployeeNameLink } from '@/components/employees/EmployeeNameLink'
import { StatusBadge } from '@/components/employees/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { sortEmployeesByHierarchy } from '@/lib/employeeHierarchy'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import { to12Hour } from '@/lib/timeFormat'
import {
  DepartmentEmployeesDialog,
  getDepartmentEmployeeCount,
  type DepartmentWithEmployees,
} from '@/components/dashboard/DepartmentEmployeesDialog'
import type { BranchDetail, Project, ProjectType } from '@/types'
import { PROJECT_TYPE_LABELS } from '@/types'

const TAB_CONFIG: { key: string; label: string; type?: ProjectType }[] = [
  { key: 'all', label: 'All Projects' },
  { key: 'HOSPITAL', label: 'Hospitals', type: 'HOSPITAL' },
  { key: 'VTI', label: 'VTIs', type: 'VTI' },
  { key: 'KITCHEN', label: 'Kitchens', type: 'KITCHEN' },
  { key: 'SOFTWARE_HOUSE', label: 'Software House', type: 'SOFTWARE_HOUSE' },
]

function projectTypeBadge(type: string) {
  const styles: Record<string, string> = {
    HOSPITAL: 'bg-blue-100 text-blue-800 border-blue-200',
    VTI: 'bg-purple-100 text-purple-800 border-purple-200',
    KITCHEN: 'bg-amber-100 text-amber-800 border-amber-200',
    SOFTWARE_HOUSE: 'bg-green-100 text-green-800 border-green-200',
  }
  return styles[type] ?? 'bg-gray-100 text-gray-700'
}

function branchEmployeeCount(branch: {
  employeeCount?: number
  _count?: { employees?: number }
}) {
  return branch.employeeCount ?? branch._count?.employees ?? 0
}

function BranchDetailSheet({
  branchId,
  open,
  onOpenChange,
}: {
  branchId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const [employeesDept, setEmployeesDept] =
    useState<DepartmentWithEmployees | null>(null)

  const { data: branch, isLoading } = useQuery({
    queryKey: ['branch-detail', branchId],
    queryFn: () => branchesApi.getOne(branchId!),
    enabled: !!branchId && open,
  })

  const { data: employees = [] } = useQuery({
    queryKey: ['employees', branchId],
    queryFn: () => employeesApi.getAll({ branchId: branchId! }),
    enabled: !!branchId && open,
  })

  const sortedEmployees = useMemo(
    () => sortEmployeesByHierarchy(employees),
    [employees],
  )

  const detail = branch as BranchDetail | undefined

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {isLoading ? (
              <Skeleton className="h-6 w-48" />
            ) : (
              <>
                {formatBranchLabel(detail, '')}
                {detail?.project && (
                  <Badge
                    variant="outline"
                    className={projectTypeBadge(detail.project.type ?? '')}
                  >
                    {detail.project.name}
                  </Badge>
                )}
              </>
            )}
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="mt-6 space-y-4">
            <Skeleton className="h-32 w-full" />
          </div>
        ) : detail ? (
          <Tabs defaultValue="employees" className="mt-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="departments">Departments</TabsTrigger>
              <TabsTrigger value="shifts">Shifts</TabsTrigger>
              <TabsTrigger value="employees">Employees</TabsTrigger>
            </TabsList>

            <TabsContent value="departments" className="space-y-4">
              {(detail.departments ?? []).length === 0 ? (
                <p className="text-sm text-text-secondary">
                  No departments configured
                </p>
              ) : (
                (detail.departments ?? []).map((dept) => {
                  const count = getDepartmentEmployeeCount(
                    dept as DepartmentWithEmployees,
                  )

                  return (
                  <div
                    key={dept.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <span className="font-medium">{dept.name}</span>
                    <button
                      type="button"
                      title="View employees in this department"
                      className="cursor-pointer text-sm font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                      onClick={() =>
                        setEmployeesDept(dept as DepartmentWithEmployees)
                      }
                    >
                      {count} employees
                    </button>
                  </div>
                  )
                })
              )}
            </TabsContent>

            <TabsContent value="shifts" className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Employees</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detail.shifts ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-text-secondary">
                        No shifts configured
                      </TableCell>
                    </TableRow>
                  ) : (
                    (detail.shifts ?? []).map((shift) => (
                      <TableRow key={shift.id}>
                        <TableCell className="font-medium">
                          {shift.name}
                        </TableCell>
                        <TableCell>{to12Hour(shift.startTime)}</TableCell>
                        <TableCell>{to12Hour(shift.endTime)}</TableCell>
                        <TableCell>{shift._count?.employees ?? 0}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="employees" className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Designation</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedEmployees.slice(0, 10).map((emp) => (
                    <TableRow key={emp.id}>
                      <TableCell className="font-mono text-xs">
                        {emp.employeeCode}
                      </TableCell>
                      <TableCell>
                        <EmployeeNameLink employee={emp} />
                      </TableCell>
                      <TableCell>{emp.currentDesignation}</TableCell>
                      <TableCell>
                        <StatusBadge status={emp.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {sortedEmployees.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-text-secondary">
                        No employees in this branch
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenChange(false)
                  navigate(`/employees?branchId=${branchId}`)
                }}
              >
                View All
              </Button>
            </TabsContent>
          </Tabs>
        ) : null}

        <DepartmentEmployeesDialog
          department={employeesDept}
          open={!!employeesDept}
          onOpenChange={(isOpen) => !isOpen && setEmployeesDept(null)}
        />
      </SheetContent>
    </Sheet>
  )
}

function ProjectSection({ project }: { project: Project }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)

  const branches = [...(project.branches ?? [])].sort(
    (a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999),
  )

  const totalEmployees = branches.reduce(
    (sum, b) => sum + branchEmployeeCount(b),
    0,
  )

  return (
    <div className="space-y-4">
      <Card
        className="cursor-pointer transition-shadow hover:shadow-md"
        onClick={() => setExpanded((v) => !v)}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {expanded ? (
                <ChevronDown className="h-5 w-5 text-text-secondary" />
              ) : (
                <ChevronRight className="h-5 w-5 text-text-secondary" />
              )}
              <CardTitle>{project.name}</CardTitle>
              <Badge
                variant="outline"
                className={projectTypeBadge(project.type)}
              >
                {PROJECT_TYPE_LABELS[project.type]}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-6 text-sm text-text-secondary">
            <span>
              <strong className="text-text-primary">
                {project._count?.branches ?? branches.length}
              </strong>{' '}
              branches
            </span>
            <span>
              <strong className="text-text-primary">{totalEmployees}</strong>{' '}
              employees
            </span>
          </div>
        </CardContent>
      </Card>

      {expanded && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {branches.length === 0 ? (
            <p className="text-sm text-text-secondary col-span-full">
              No branches in this project
            </p>
          ) : (
            branches.map((branch) => (
              <Card
                key={branch.id}
                className="transition-shadow hover:shadow-md"
              >
                <CardContent className="space-y-3 p-5">
                  <p className="text-lg font-bold">{branch.name}</p>
                  <p className="text-sm text-text-secondary">
                    {branch.address || 'No address'}
                  </p>
                  <div className="flex flex-wrap gap-3 text-xs text-text-secondary">
                    <span>
                      {branch._count?.departments ?? 0} departments
                    </span>
                    <span>{branchEmployeeCount(branch)} employees</span>
                    <span>{branch._count?.shifts ?? 0} shifts</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/employees?branchId=${branch.id}`)
                      }}
                    >
                      View Employees
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedBranch(branch.id)
                      }}
                    >
                      Details
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      <BranchDetailSheet
        branchId={selectedBranch}
        open={!!selectedBranch}
        onOpenChange={(v) => !v && setSelectedBranch(null)}
      />
    </div>
  )
}

export function BranchesPage() {
  const [activeTab, setActiveTab] = useState('all')

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(),
  })

  const filteredProjects = projects.filter((p) => {
    const tab = TAB_CONFIG.find((t) => t.key === activeTab)
    if (!tab?.type) return true
    return p.type === tab.type
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Building2 className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-bold text-text-primary">
          Branches & Projects
        </h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex h-auto flex-wrap gap-1">
          {TAB_CONFIG.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TAB_CONFIG.map((tab) => (
          <TabsContent key={tab.key} value={tab.key} className="mt-6 space-y-8">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <div className="grid grid-cols-3 gap-4">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-40" />
                  ))}
                </div>
              </div>
            ) : filteredProjects.length === 0 ? (
              <p className="text-text-secondary">No projects found</p>
            ) : (
              filteredProjects.map((project) => (
                <ProjectSection key={project.id} project={project} />
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
