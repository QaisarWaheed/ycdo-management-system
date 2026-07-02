import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { employeesApi } from '@/api/endpoints/employees'
import { projectsApi } from '@/api/endpoints/projects'
import { shiftsApi } from '@/api/endpoints/shifts'
import { StatusBadge } from '@/components/employees/StatusBadge'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { toast } from '@/hooks/use-toast'
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

function AddShiftDialog({
  branchId,
  open,
  onOpenChange,
  onSuccess,
}: {
  branchId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const [name, setName] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      shiftsApi.create({ branchId, name, startTime, endTime }),
    onSuccess: () => {
      toast({ title: 'Shift created' })
      setName('')
      setStartTime('')
      setEndTime('')
      onOpenChange(false)
      onSuccess()
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to create shift',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Shift</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Shift Name</Label>
            <Input
              placeholder="Morning Shift"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Time (HH:MM)</Label>
              <Input
                placeholder="09:00"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>End Time (HH:MM)</Label>
              <Input
                placeholder="17:00"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={!name || !startTime || !endTime || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Creating...' : 'Create Shift'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddBranchDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(),
  })

  const mutation = useMutation({
    mutationFn: () =>
      branchesApi.create({
        name,
        projectId: projectId || undefined,
        address: address || undefined,
        phone: phone || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Branch created' })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['branches'] })
      setName('')
      setProjectId('')
      setAddress('')
      setPhone('')
      onOpenChange(false)
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to create branch',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Branch</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Branch Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            className="bg-primary hover:bg-primary-dark"
            disabled={!name || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Creating...' : 'Create Branch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
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
  const queryClient = useQueryClient()
  const [addShiftOpen, setAddShiftOpen] = useState(false)
  const [addingDept, setAddingDept] = useState(false)
  const [deptName, setDeptName] = useState('')

  const { data: branch, isLoading, refetch } = useQuery({
    queryKey: ['branch-detail', branchId],
    queryFn: () => branchesApi.getOne(branchId!),
    enabled: !!branchId && open,
  })

  const { data: employees = [] } = useQuery({
    queryKey: ['employees', branchId],
    queryFn: () => employeesApi.getAll({ branchId: branchId! }),
    enabled: !!branchId && open,
  })

  const addDeptMutation = useMutation({
    mutationFn: () =>
      departmentsApi.create({ name: deptName, branchId: branchId! }),
    onSuccess: () => {
      toast({ title: 'Department added' })
      setDeptName('')
      setAddingDept(false)
      refetch()
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to add department',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const detail = branch as BranchDetail | undefined

  return (
    <>
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
            <Tabs defaultValue="departments" className="mt-6">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="departments">Departments</TabsTrigger>
                <TabsTrigger value="shifts">Shifts</TabsTrigger>
                <TabsTrigger value="employees">Employees</TabsTrigger>
              </TabsList>

              <TabsContent value="departments" className="space-y-4">
                {(detail.departments ?? []).map((dept) => (
                  <div
                    key={dept.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <span className="font-medium">{dept.name}</span>
                    <span className="text-sm text-text-secondary">
                      {dept._count?.employees ?? 0} employees
                    </span>
                  </div>
                ))}

                {addingDept ? (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Department name"
                      value={deptName}
                      onChange={(e) => setDeptName(e.target.value)}
                    />
                    <Button
                      size="sm"
                      disabled={!deptName || addDeptMutation.isPending}
                      onClick={() => addDeptMutation.mutate()}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAddingDept(false)
                        setDeptName('')
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAddingDept(true)}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add Department
                  </Button>
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
                          <TableCell>{shift.startTime}</TableCell>
                          <TableCell>{shift.endTime}</TableCell>
                          <TableCell>{shift._count?.employees ?? 0}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddShiftOpen(true)}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add Shift
                </Button>
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
                    {employees.slice(0, 10).map((emp) => (
                      <TableRow key={emp.id}>
                        <TableCell className="font-mono text-xs">
                          {emp.employeeCode}
                        </TableCell>
                        <TableCell>
                          {emp.fullName}
                        </TableCell>
                        <TableCell>{emp.currentDesignation}</TableCell>
                        <TableCell>
                          <StatusBadge status={emp.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {employees.length === 0 && (
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
        </SheetContent>
      </Sheet>

      {branchId && (
        <AddShiftDialog
          branchId={branchId}
          open={addShiftOpen}
          onOpenChange={setAddShiftOpen}
          onSuccess={() => refetch()}
        />
      )}
    </>
  )
}

function ProjectSection({ project }: { project: Project }) {
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)

  const totalEmployees =
    project.branches?.reduce(
      (sum, b) => sum + (b._count?.employees ?? 0),
      0,
    ) ?? 0

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>{project.name}</CardTitle>
            <Badge
              variant="outline"
              className={projectTypeBadge(project.type)}
            >
              {PROJECT_TYPE_LABELS[project.type]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-6 text-sm text-text-secondary">
            <span>
              <strong className="text-text-primary">
                {project._count?.branches ?? project.branches?.length ?? 0}
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(project.branches ?? []).map((branch) => (
          <Card key={branch.id} className="transition-shadow hover:shadow-md">
            <CardContent className="space-y-3 p-5">
              <p className="text-lg font-bold">{branch.name}</p>
              <p className="text-sm text-text-secondary">
                {branch.address || 'No address'}
              </p>
              <div className="flex flex-wrap gap-3 text-xs text-text-secondary">
                <span>{branch._count?.departments ?? 0} departments</span>
                <span>{branch._count?.employees ?? 0} employees</span>
                <span>{branch._count?.shifts ?? 0} shifts</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setSelectedBranch(branch.id)}
              >
                View Details
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

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
  const [addBranchOpen, setAddBranchOpen] = useState(false)

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold text-text-primary">
            Branches & Projects
          </h1>
        </div>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setAddBranchOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Branch
        </Button>
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

      <AddBranchDialog open={addBranchOpen} onOpenChange={setAddBranchOpen} />
    </div>
  )
}
