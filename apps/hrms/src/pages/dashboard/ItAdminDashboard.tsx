import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
import { projectsApi } from '@/api/endpoints/projects'
import {
  DESIGNATION_CATEGORIES,
  designationsApi,
  type Designation,
} from '@/api/endpoints/designations'
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
import type { Branch, Department, Project, ProjectType, Shift } from '@/types'
import { PROJECT_TYPE_LABELS } from '@/types'
import { formatBranchLabel } from '@/lib/formatBranchLabel'
import { PhoneInput } from '@/components/common/PhoneInput'
import { shiftsApi } from '@/api/endpoints/shifts'
import { locationValuesApi } from '@/api/endpoints/locationValues'
import { biometricDevicesApi, type BiometricDevice } from '@/api/endpoints/biometricDevices'
import { format } from 'date-fns'

function BranchesTab() {
  const queryClient = useQueryClient()
  const [projectFilter, setProjectFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editBranch, setEditBranch] = useState<Branch | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [projectId, setProjectId] = useState('')

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(),
  })

  const { data: branches = [], isLoading } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', 'all'],
    queryFn: () => departmentsApi.getAll(),
  })

  const filteredBranches = projectFilter
    ? branches.filter((b) => b.projectId === projectFilter)
    : branches

  const deptCountByBranch = (branchId: string) =>
    departments.filter((d) => d.branchId === branchId).length

  const resetForm = () => {
    setName('')
    setAddress('')
    setPhone('')
    setProjectId('')
  }

  const createMutation = useMutation({
    mutationFn: () =>
      branchesApi.create({
        name,
        address: address || undefined,
        phone: phone || undefined,
        projectId: projectId || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Branch created' })
      resetForm()
      setCreateOpen(false)
      queryClient.invalidateQueries({ queryKey: ['branches'] })
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

  const updateMutation = useMutation({
    mutationFn: () =>
      branchesApi.update(editBranch!.id, {
        name,
        address: address || undefined,
        phone: phone || undefined,
        projectId: projectId || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Branch updated' })
      setEditBranch(null)
      resetForm()
      queryClient.invalidateQueries({ queryKey: ['branches'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to update branch',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => branchesApi.deactivate(id),
    onSuccess: () => {
      toast({ title: 'Branch deactivated' })
      queryClient.invalidateQueries({ queryKey: ['branches'] })
    },
    onError: () => {
      toast({ title: 'Failed to deactivate branch', variant: 'destructive' })
    },
  })

  const openEdit = (branch: Branch) => {
    setEditBranch(branch)
    setName(branch.name)
    setAddress(branch.address ?? '')
    setPhone(branch.phone ?? '')
    setProjectId(branch.projectId ?? '')
  }

  const branchForm = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Address</Label>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Phone</Label>
        <PhoneInput value={phone} onChange={setPhone} />
      </div>
      <div className="space-y-2">
        <Label>Project</Label>
        <Select value={projectId || 'none'} onValueChange={(v) => setProjectId(v === 'none' ? '' : v)}>
          <SelectTrigger>
            <SelectValue placeholder="Select project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No project</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Label>Filter by Project</Label>
          <Select
            value={projectFilter || 'all'}
            onValueChange={(v) => setProjectFilter(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Branch
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Departments</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(4)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(7)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredBranches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-text-secondary">
                    No branches found
                  </TableCell>
                </TableRow>
              ) : (
                filteredBranches.map((branch) => (
                  <TableRow key={branch.id}>
                    <TableCell className="font-medium">{branch.name}</TableCell>
                    <TableCell>{branch.address ?? '—'}</TableCell>
                    <TableCell>{branch.phone ?? '—'}</TableCell>
                    <TableCell>
                      {projects.find((p) => p.id === branch.projectId)?.name ?? '—'}
                    </TableCell>
                    <TableCell>{deptCountByBranch(branch.id)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {branch.isActive === false ? 'Inactive' : 'Active'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(branch)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => {
                            if (
                              window.confirm(
                                'Deactivate this branch? Employees will remain but branch will be hidden.',
                              )
                            ) {
                              deactivateMutation.mutate(branch.id)
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Branch</DialogTitle>
          </DialogHeader>
          {branchForm}
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!name || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editBranch}
        onOpenChange={(open) => {
          if (!open) {
            setEditBranch(null)
            resetForm()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Branch</DialogTitle>
          </DialogHeader>
          {branchForm}
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!name || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DepartmentsTab() {
  const queryClient = useQueryClient()
  const [branchFilter, setBranchFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editDept, setEditDept] = useState<Department | null>(null)
  const [name, setName] = useState('')
  const [branchId, setBranchId] = useState('')

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['departments', branchFilter || 'all'],
    queryFn: () =>
      departmentsApi.getAll(branchFilter ? { branchId: branchFilter } : undefined),
  })

  const createMutation = useMutation({
    mutationFn: () => departmentsApi.create({ name, branchId }),
    onSuccess: () => {
      toast({ title: 'Department created' })
      setName('')
      setBranchId('')
      setCreateOpen(false)
      queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to create department',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: () => departmentsApi.update(editDept!.id, { name }),
    onSuccess: () => {
      toast({ title: 'Department updated' })
      setEditDept(null)
      setName('')
      queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to update department',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => departmentsApi.deactivate(id),
    onSuccess: () => {
      toast({ title: 'Department deactivated' })
      queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: () => {
      toast({ title: 'Failed to deactivate department', variant: 'destructive' })
    },
  })

  const openEdit = (dept: Department) => {
    setEditDept(dept)
    setName(dept.name)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Label>Filter by Branch</Label>
          <Select
            value={branchFilter || 'all'}
            onValueChange={(v) => setBranchFilter(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="All branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {formatBranchLabel(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Department
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Employees</TableHead>
                <TableHead className="w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(4)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(4)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : departments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-text-secondary">
                    No departments found
                  </TableCell>
                </TableRow>
              ) : (
                (departments as (Department & {
                  branch?: { name: string }
                  _count?: { employees: number }
                })[]).map((dept) => (
                  <TableRow key={dept.id}>
                    <TableCell className="font-medium">{dept.name}</TableCell>
                    <TableCell>{formatBranchLabel(dept.branch)}</TableCell>
                    <TableCell>{dept._count?.employees ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(dept)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Deactivate department "${dept.name}"?`,
                              )
                            ) {
                              deactivateMutation.mutate(dept.id)
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Department</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Branch</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {formatBranchLabel(b)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Department Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Human Resources"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!name || !branchId || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editDept}
        onOpenChange={(open) => {
          if (!open) {
            setEditDept(null)
            setName('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Department</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Department Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!name || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DesignationsTab() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editItem, setEditItem] = useState<Designation | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<string>(DESIGNATION_CATEGORIES[0])

  const { data: designations = [], isLoading } = useQuery({
    queryKey: ['designations'],
    queryFn: () => designationsApi.getAll(),
  })

  const createMutation = useMutation({
    mutationFn: () => designationsApi.create({ title, category }),
    onSuccess: () => {
      toast({ title: 'Designation created' })
      setTitle('')
      setCategory(DESIGNATION_CATEGORIES[0])
      setCreateOpen(false)
      queryClient.invalidateQueries({ queryKey: ['designations'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to create designation',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      designationsApi.update(editItem!.id, { title, category }),
    onSuccess: () => {
      toast({ title: 'Designation updated' })
      setEditItem(null)
      setTitle('')
      queryClient.invalidateQueries({ queryKey: ['designations'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to update designation',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => designationsApi.deactivate(id),
    onSuccess: () => {
      toast({ title: 'Designation deactivated' })
      queryClient.invalidateQueries({ queryKey: ['designations'] })
    },
    onError: () => {
      toast({ title: 'Failed to deactivate designation', variant: 'destructive' })
    },
  })

  const openEdit = (item: Designation) => {
    setEditItem(item)
    setTitle(item.title)
    setCategory(item.category)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Designation
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(4)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(3)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : designations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-text-secondary">
                    No designations found
                  </TableCell>
                </TableRow>
              ) : (
                (designations as Designation[]).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.category}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Deactivate designation "${item.title}"?`,
                              )
                            ) {
                              deactivateMutation.mutate(item.id)
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Designation</DialogTitle>
          </DialogHeader>
          <DesignationForm
            title={title}
            category={category}
            onTitleChange={setTitle}
            onCategoryChange={setCategory}
          />
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!title || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editItem}
        onOpenChange={(open) => {
          if (!open) {
            setEditItem(null)
            setTitle('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Designation</DialogTitle>
          </DialogHeader>
          <DesignationForm
            title={title}
            category={category}
            onTitleChange={setTitle}
            onCategoryChange={setCategory}
          />
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!title || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DesignationForm({
  title,
  category,
  onTitleChange,
  onCategoryChange,
}: {
  title: string
  category: string
  onTitleChange: (value: string) => void
  onCategoryChange: (value: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Title</Label>
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="e.g. Nurse"
        />
      </div>
      <div className="space-y-2">
        <Label>Category</Label>
        <Select value={category} onValueChange={onCategoryChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DESIGNATION_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

const PROJECT_TYPES = Object.keys(PROJECT_TYPE_LABELS) as ProjectType[]

const LOCATION_VALUE_TYPES = [
  { value: 'city', label: 'City' },
  { value: 'district', label: 'District' },
  { value: 'tehsil', label: 'Tehsil' },
  { value: 'police_station', label: 'Police Station' },
] as const

function ProjectsTab() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<ProjectType>('HOSPITAL')

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(),
  })

  const createMutation = useMutation({
    mutationFn: () => projectsApi.create({ name, type }),
    onSuccess: () => {
      toast({ title: 'Project created' })
      setName('')
      setType('HOSPITAL')
      setCreateOpen(false)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to create project',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: () => projectsApi.update(editProject!.id, { name, type }),
    onSuccess: () => {
      toast({ title: 'Project updated' })
      setEditProject(null)
      setName('')
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to update project',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => projectsApi.deactivate(id),
    onSuccess: () => {
      toast({ title: 'Project deactivated' })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: () => {
      toast({ title: 'Failed to deactivate project', variant: 'destructive' })
    },
  })

  const openEdit = (project: Project) => {
    setEditProject(project)
    setName(project.name)
    setType(project.type)
  }

  const projectForm = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Project Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Central Hospital"
        />
      </div>
      <div className="space-y-2">
        <Label>Type</Label>
        <Select value={type} onValueChange={(v) => setType(v as ProjectType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {PROJECT_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Project
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Branches</TableHead>
                <TableHead className="w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(4)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(4)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : projects.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-text-secondary">
                    No projects found
                  </TableCell>
                </TableRow>
              ) : (
                projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell className="font-medium">{project.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {PROJECT_TYPE_LABELS[project.type]}
                      </Badge>
                    </TableCell>
                    <TableCell>{project._count?.branches ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(project)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Deactivate project "${project.name}"?`,
                              )
                            ) {
                              deactivateMutation.mutate(project.id)
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Project</DialogTitle>
          </DialogHeader>
          {projectForm}
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!name || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editProject}
        onOpenChange={(open) => {
          if (!open) {
            setEditProject(null)
            setName('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
          </DialogHeader>
          {projectForm}
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!name || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ShiftsTab() {
  const queryClient = useQueryClient()
  const [branchFilter, setBranchFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editShift, setEditShift] = useState<Shift | null>(null)
  const [branchId, setBranchId] = useState('')
  const [name, setName] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['shifts', branchFilter || 'all'],
    queryFn: () =>
      shiftsApi.getAll(branchFilter || undefined),
  })

  const resetForm = () => {
    setBranchId('')
    setName('')
    setStartTime('')
    setEndTime('')
  }

  const createMutation = useMutation({
    mutationFn: () =>
      shiftsApi.create({ branchId, name, startTime, endTime }),
    onSuccess: () => {
      toast({ title: 'Shift created' })
      resetForm()
      setCreateOpen(false)
      queryClient.invalidateQueries({ queryKey: ['shifts'] })
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

  const updateMutation = useMutation({
    mutationFn: () =>
      shiftsApi.update(editShift!.id, { name, startTime, endTime }),
    onSuccess: () => {
      toast({ title: 'Shift updated' })
      setEditShift(null)
      resetForm()
      queryClient.invalidateQueries({ queryKey: ['shifts'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to update shift',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const shiftForm = (
    <div className="space-y-4">
      {!editShift && (
        <div className="space-y-2">
          <Label>Branch</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger>
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {formatBranchLabel(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <Label>Shift Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Morning Shift"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Start Time (HH:MM)</Label>
          <Input
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            placeholder="09:00"
          />
        </div>
        <div className="space-y-2">
          <Label>End Time (HH:MM)</Label>
          <Input
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            placeholder="17:00"
          />
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Label>Filter by Branch</Label>
          <Select
            value={branchFilter || 'all'}
            onValueChange={(v) => setBranchFilter(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="All branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {formatBranchLabel(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Shift
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
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
              ) : shifts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-text-secondary">
                    No shifts found
                  </TableCell>
                </TableRow>
              ) : (
                shifts.map((shift) => (
                  <TableRow key={shift.id}>
                    <TableCell className="font-medium">{shift.name}</TableCell>
                    <TableCell>{formatBranchLabel(shift.branch)}</TableCell>
                    <TableCell>{shift.startTime}</TableCell>
                    <TableCell>{shift.endTime}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditShift(shift)
                          setName(shift.name)
                          setStartTime(shift.startTime)
                          setEndTime(shift.endTime)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Shift</DialogTitle>
          </DialogHeader>
          {shiftForm}
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={
                !branchId || !name || !startTime || !endTime || createMutation.isPending
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editShift}
        onOpenChange={(open) => {
          if (!open) {
            setEditShift(null)
            resetForm()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Shift</DialogTitle>
          </DialogHeader>
          {shiftForm}
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!name || !startTime || !endTime || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LocationValuesTab() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [type, setType] = useState<string>('city')
  const [value, setValue] = useState('')
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')
  const [typeFilter, setTypeFilter] = useState('city')

  const { data: locationValues = [], isLoading } = useQuery({
    queryKey: ['location-values', typeFilter],
    queryFn: () => locationValuesApi.getAll(typeFilter),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      locationValuesApi.create({
        type,
        value,
        province: province || undefined,
        city: city || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Location value added' })
      setValue('')
      setProvince('')
      setCity('')
      setCreateOpen(false)
      queryClient.invalidateQueries({ queryKey: ['location-values'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to add location value',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Label>Filter by Type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCATION_VALUE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => {
            setType(typeFilter)
            setCreateOpen(true)
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Location Value
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Value</TableHead>
                <TableHead>Province</TableHead>
                <TableHead>City</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(4)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(3)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : locationValues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-text-secondary">
                    No location values found
                  </TableCell>
                </TableRow>
              ) : (
                locationValues.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.value}</TableCell>
                    <TableCell>{item.province ?? '—'}</TableCell>
                    <TableCell>{item.city ?? '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Location Value</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCATION_VALUE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Value</Label>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Enter value"
              />
            </div>
            <div className="space-y-2">
              <Label>Province (optional)</Label>
              <Input
                value={province}
                onChange={(e) => setProvince(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>City (optional)</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!value.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Adding...' : 'Add Value'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DevicesTab() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editDevice, setEditDevice] = useState<BiometricDevice | null>(null)
  const [deviceId, setDeviceId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [label, setLabel] = useState('')

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.getAll(),
  })

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['biometric-devices'],
    queryFn: () => biometricDevicesApi.getAll(),
  })

  const resetForm = () => {
    setDeviceId('')
    setBranchId('')
    setLabel('')
  }

  const createMutation = useMutation({
    mutationFn: () =>
      biometricDevicesApi.create({
        deviceId: deviceId.trim(),
        branchId,
        label: label.trim() || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Device added' })
      resetForm()
      setCreateOpen(false)
      queryClient.invalidateQueries({ queryKey: ['biometric-devices'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to add device',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      biometricDevicesApi.update(editDevice!.id, {
        deviceId: deviceId.trim(),
        branchId,
        label: label.trim() || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Device updated' })
      setEditDevice(null)
      resetForm()
      queryClient.invalidateQueries({ queryKey: ['biometric-devices'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to update device',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => biometricDevicesApi.remove(id),
    onSuccess: () => {
      toast({ title: 'Device deleted' })
      queryClient.invalidateQueries({ queryKey: ['biometric-devices'] })
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message
      toast({
        title: 'Failed to delete device',
        description: Array.isArray(msg) ? msg.join(', ') : String(msg ?? 'Error'),
        variant: 'destructive',
      })
    },
  })

  const openEdit = (device: BiometricDevice) => {
    setEditDevice(device)
    setDeviceId(device.deviceId)
    setBranchId(device.branchId)
    setLabel(device.label ?? '')
  }

  const deviceForm = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Device ID</Label>
        <Input
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          placeholder="e.g. YCDO-CENTRAL-HOSPITAL"
        />
      </div>
      <div className="space-y-2">
        <Label>Branch</Label>
        <Select value={branchId || 'none'} onValueChange={(v) => setBranchId(v === 'none' ? '' : v)}>
          <SelectTrigger>
            <SelectValue placeholder="Select branch" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Select branch</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {formatBranchLabel(b)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Label (optional)</Label>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Main Entrance"
        />
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          className="bg-primary hover:bg-primary-dark"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Device
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device ID</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Added On</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(5)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : devices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-text-secondary">
                    No biometric devices registered
                  </TableCell>
                </TableRow>
              ) : (
                devices.map((device) => (
                  <TableRow key={device.id}>
                    <TableCell className="font-mono text-sm">{device.deviceId}</TableCell>
                    <TableCell>{device.branch?.name ?? '—'}</TableCell>
                    <TableCell>{device.label ?? '—'}</TableCell>
                    <TableCell>
                      {format(new Date(device.createdAt), 'dd MMM yyyy')}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(device)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete device "${device.deviceId}"? This cannot be undone.`,
                              )
                            ) {
                              deleteMutation.mutate(device.id)
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Biometric Device</DialogTitle>
          </DialogHeader>
          {deviceForm}
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!deviceId.trim() || !branchId || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Adding...' : 'Add Device'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editDevice}
        onOpenChange={(open) => {
          if (!open) {
            setEditDevice(null)
            resetForm()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Biometric Device</DialogTitle>
          </DialogHeader>
          {deviceForm}
          <DialogFooter>
            <Button
              className="bg-primary hover:bg-primary-dark"
              disabled={!deviceId.trim() || !branchId || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ItAdminDashboard() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Organization Setup</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="projects">
            <TabsList className="flex h-auto flex-wrap gap-1">
              <TabsTrigger value="projects">Projects</TabsTrigger>
              <TabsTrigger value="branches">Branches</TabsTrigger>
              <TabsTrigger value="departments">Departments</TabsTrigger>
              <TabsTrigger value="designations">Designations</TabsTrigger>
              <TabsTrigger value="shifts">Shifts</TabsTrigger>
              <TabsTrigger value="locations">Locations</TabsTrigger>
              <TabsTrigger value="devices">Devices</TabsTrigger>
            </TabsList>
            <TabsContent value="projects" className="mt-4">
              <ProjectsTab />
            </TabsContent>
            <TabsContent value="departments" className="mt-4">
              <DepartmentsTab />
            </TabsContent>
            <TabsContent value="designations" className="mt-4">
              <DesignationsTab />
            </TabsContent>
            <TabsContent value="branches" className="mt-4">
              <BranchesTab />
            </TabsContent>
            <TabsContent value="shifts" className="mt-4">
              <ShiftsTab />
            </TabsContent>
            <TabsContent value="locations" className="mt-4">
              <LocationValuesTab />
            </TabsContent>
            <TabsContent value="devices" className="mt-4">
              <DevicesTab />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
