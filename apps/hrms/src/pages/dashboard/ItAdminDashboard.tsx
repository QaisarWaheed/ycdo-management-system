import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { branchesApi } from '@/api/endpoints/branches'
import { departmentsApi } from '@/api/endpoints/departments'
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
import type { Department } from '@/types'

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
                  {b.name}
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
                    <TableCell>{dept.branch?.name ?? '—'}</TableCell>
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
                      {b.name}
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

export function ItAdminDashboard() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Organization Setup</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="departments">
            <TabsList>
              <TabsTrigger value="departments">Departments</TabsTrigger>
              <TabsTrigger value="designations">Designations</TabsTrigger>
            </TabsList>
            <TabsContent value="departments" className="mt-4">
              <DepartmentsTab />
            </TabsContent>
            <TabsContent value="designations" className="mt-4">
              <DesignationsTab />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
